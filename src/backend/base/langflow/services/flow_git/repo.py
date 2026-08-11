"""GitRepoService — GitPython + system git on PATH."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse, urlunparse
from uuid import UUID

from langflow.services.flow_git.conflicts import (
    flow_ids_from_unmerged_paths,
    has_unresolved_conflicts,
    list_conflicts,
    store_conflict,
)
from langflow.services.flow_git.credentials import load_pat
from langflow.services.flow_git.detect import require_git_binary
from langflow.services.flow_git.exceptions import (
    DirtyWorktreeError,
    GitAuthError,
    GitConflictError,
    GitPushRejectedError,
    GitRepoNotFoundError,
    GitSotError,
    ImmutablePathError,
    SecretPatternBlockedError,
)
from langflow.services.flow_git.secret_scan import assert_no_raw_secret_patterns
from langflow.services.flow_git.ops_log import append_ops_log
from langflow.services.flow_git.lockfile import (
    apply_selected_paths_to_lock,
    lock_from_git_blob,
    read_lock,
    restore_selected_paths_in_lock,
    write_lock,
)
from langflow.services.flow_git.paths import flow_path_for_id, flow_relpath_for_id
from langflow.services.flow_git.production_branch import (
    assert_checkout_allowed_dirty,
    assert_not_immutable_path,
    ensure_production_branch_file,
    read_production_branch,
)

logger = logging.getLogger("langflow.flow_git")

_UUID_IN_FLOW = re.compile(r"^flows/([0-9a-fA-F-]{36})\.json$")
_UUID_IN_SECRET = re.compile(r"^secrets/vars/([0-9a-fA-F-]{36})\.json$")


@dataclass
class StatusEntry:
    path: str
    index_status: str
    worktree_status: str
    flow_id: str | None = None
    flow_name: str | None = None
    change_kind: str = "unchanged"  # created | modified | deleted | unchanged | renamed

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "index_status": self.index_status,
            "worktree_status": self.worktree_status,
            "flow_id": self.flow_id,
            "flow_name": self.flow_name,
            "change_kind": self.change_kind,
        }


@dataclass
class RepoStatus:
    branch: str | None
    production_branch: str | None
    on_production: bool
    dirty: bool
    entries: list[StatusEntry] = field(default_factory=list)
    ahead: int | None = None
    behind: int | None = None
    ahead_of_production: int | None = None
    unresolved_conflicts: bool = False
    # True when refs/remotes/origin/<branch> exists (publishable otherwise).
    has_upstream: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "branch": self.branch,
            "production_branch": self.production_branch,
            "on_production": self.on_production,
            "dirty": self.dirty,
            "entries": [e.to_dict() for e in self.entries],
            "ahead": self.ahead,
            "behind": self.behind,
            "ahead_of_production": self.ahead_of_production,
            "unresolved_conflicts": self.unresolved_conflicts,
            "has_upstream": self.has_upstream,
        }


def _import_git():
    require_git_binary()
    try:
        import git
    except ImportError as exc:
        raise GitSotError(
            "GitPython not installed. Install langflow-base deps including GitPython.",
            code="GITPYTHON_MISSING",
        ) from exc
    return git


def _auth_url(url: str, token: str | None) -> str:
    if not token:
        return url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return url
    # oauth2:token@host for GitLab HTTPS
    netloc = f"oauth2:{quote(token, safe='')}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def _flow_id_from_path(path: str) -> str | None:
    m = _UUID_IN_FLOW.match(path.replace("\\", "/"))
    return m.group(1) if m else None


def _secret_id_from_path(path: str) -> str | None:
    m = _UUID_IN_SECRET.match(path.replace("\\", "/"))
    return m.group(1) if m else None


def _entry_display_name(repo_root: Path, rel_path: str, repo: Any | None = None) -> str | None:
    rel = rel_path.replace("\\", "/")
    if rel.startswith("secrets/"):
        from langflow.services.flow_git.secrets_store import read_secret_display_name

        return read_secret_display_name(repo_root, rel, repo)
    if rel.startswith("flows/"):
        return _read_flow_name(repo_root, rel, repo)
    return None


def _read_flow_name(repo_root: Path, rel_path: str, repo: Any | None = None) -> str | None:
    """Best-effort flow display name from working tree or HEAD."""
    import json

    path = Path(repo_root) / rel_path
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            name = data.get("name")
            if isinstance(name, str) and name.strip():
                return name.strip()
        except Exception:  # noqa: BLE001
            pass
    if repo is not None:
        try:
            raw = repo.git.show(f"HEAD:{rel_path}")
            data = json.loads(raw)
            name = data.get("name")
            if isinstance(name, str) and name.strip():
                return name.strip()
        except Exception:  # noqa: BLE001
            pass
    return None


def _change_kind(index_status: str, worktree_status: str) -> str:
    pair = f"{index_status}{worktree_status}"
    if "D" in pair:
        return "deleted"
    if "?" in pair or "A" in pair:
        return "created"
    if "R" in pair or "C" in pair:
        return "renamed"
    if "M" in pair or "U" in pair or "T" in pair:
        return "modified"
    if index_status.strip() or worktree_status.strip():
        return "modified"
    return "unchanged"


def _guard_paths(paths: list[str] | None) -> None:
    if not paths:
        return
    for p in paths:
        try:
            assert_not_immutable_path(p)
        except ImmutablePathError:
            raise


def _normalize_repo_relpath(repo_root: Path, rel: str) -> str:
    """Reject empty / absolute / traversal paths; return posix relative."""
    raw = (rel or "").strip().replace("\\", "/")
    if not raw or raw.startswith("/") or ".." in raw.split("/"):
        raise GitSotError(f"Invalid path: {rel}", code="GIT_BAD_PATH")
    abs_path = (repo_root / raw).resolve()
    try:
        abs_path.relative_to(repo_root.resolve())
    except ValueError as exc:
        raise GitSotError(f"Path escapes repo: {rel}", code="GIT_BAD_PATH") from exc
    return raw


class GitRepoService:
    """Open/clone a flows git working tree and run git ops."""

    def __init__(self, repo_root: Path | str) -> None:
        self.repo_root = Path(repo_root).expanduser().resolve()
        self._repo = None

    # --- lifecycle ---------------------------------------------------------

    @classmethod
    def clone(
        cls,
        url: str,
        dest_dir: Path | str,
        *,
        token: str | None = None,
        branch: str | None = None,
    ) -> GitRepoService:
        git = _import_git()
        dest = Path(dest_dir).expanduser().resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)
        token = token or load_pat()
        auth = _auth_url(url, token)
        kwargs: dict[str, Any] = {}
        if branch:
            kwargs["branch"] = branch
        try:
            git.Repo.clone_from(auth, str(dest), **kwargs)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "Authentication" in msg or "401" in msg or "403" in msg or "could not read Username" in msg:
                raise GitAuthError(f"Clone auth failed: {msg}") from exc
            raise GitSotError(f"Clone failed: {msg}") from exc
        svc = cls(dest)
        from langflow.services.flow_git.setup import ensure_repo_layout

        ensure_repo_layout(svc.repo_root, mode="existing")
        append_ops_log(svc.repo_root, op="clone", ok=True, detail={"url": url, "branch": branch})
        return svc

    @classmethod
    def test_connection(cls, url: str, *, token: str | None = None) -> dict[str, Any]:
        """``git ls-remote`` against *url* (with optional PAT). Never logs token."""
        git = _import_git()
        token = token or load_pat()
        if not url or not str(url).strip():
            raise GitSotError("Repository URL required", code="GIT_URL_REQUIRED")
        auth = _auth_url(url.strip(), token)
        try:
            out = git.cmd.Git().ls_remote(auth)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if (
                "Authentication" in msg
                or "401" in msg
                or "403" in msg
                or "could not read Username" in msg
                or "Invalid username" in msg
                or "Access denied" in msg
            ):
                raise GitAuthError(f"Connection auth failed: {msg}") from exc
            raise GitSotError(f"Connection failed: {msg}") from exc
        heads = []
        for line in (out or "").splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1].startswith("refs/heads/"):
                heads.append(parts[1].removeprefix("refs/heads/"))
        return {"ok": True, "heads": heads[:50], "head_count": len(heads)}

    @classmethod
    def open(cls, dir_path: Path | str) -> GitRepoService:
        git = _import_git()
        root = Path(dir_path).expanduser().resolve()
        if not (root / ".git").exists():
            # allow bare working tree init later; still error for open
            raise GitRepoNotFoundError(f"Not a git repository: {root}")
        try:
            git.Repo(str(root))
        except Exception as exc:  # noqa: BLE001
            raise GitRepoNotFoundError(f"Cannot open git repo: {root}: {exc}") from exc
        return cls(root)

    def _get_repo(self):
        git = _import_git()
        if self._repo is None:
            try:
                self._repo = git.Repo(str(self.repo_root))
            except Exception as exc:  # noqa: BLE001
                raise GitRepoNotFoundError(str(exc)) from exc
        return self._repo

    # --- read ops ----------------------------------------------------------

    def current_branch(self) -> str | None:
        repo = self._get_repo()
        try:
            return repo.active_branch.name
        except TypeError:
            return None  # detached HEAD

    def production_branch(self) -> str | None:
        return read_production_branch(self.repo_root)

    def is_dirty(self) -> bool:
        return self._get_repo().is_dirty(untracked_files=True)

    def status(self) -> RepoStatus:
        repo = self._get_repo()
        branch = self.current_branch()
        prod = self.production_branch()
        by_path: dict[str, StatusEntry] = {}
        # porcelain: XY PATH
        try:
            raw = repo.git.status(porcelain=True)
        except Exception as exc:  # noqa: BLE001
            raise GitSotError(f"status failed: {exc}") from exc
        for line in (raw or "").splitlines():
            if not line or len(line) < 3:
                continue
            xy, path = line[:2], line[3:].strip()
            # rename: "R  old -> new"
            if " -> " in path:
                path = path.split(" -> ", 1)[-1]
            path = path.replace("\\", "/")
            fid = _flow_id_from_path(path)
            kind = _change_kind(xy[0], xy[1])
            by_path[path] = StatusEntry(
                path=path,
                index_status=xy[0],
                worktree_status=xy[1],
                flow_id=fid,
                flow_name=_entry_display_name(self.repo_root, path, repo),
                change_kind=kind,
            )

        # Include clean flows/*.json as unchanged so the panel lists full tree
        flows_dir = self.repo_root / "flows"
        if flows_dir.is_dir():
            for p in sorted(flows_dir.glob("*.json")):
                rel = f"flows/{p.name}"
                if rel in by_path:
                    continue
                fid = _flow_id_from_path(rel)
                by_path[rel] = StatusEntry(
                    path=rel,
                    index_status=" ",
                    worktree_status=" ",
                    flow_id=fid,
                    flow_name=_entry_display_name(self.repo_root, rel, repo),
                    change_kind="unchanged",
                )

        secrets_dir = self.repo_root / "secrets" / "vars"
        if secrets_dir.is_dir():
            for p in sorted(secrets_dir.glob("*.json")):
                rel = f"secrets/vars/{p.name}"
                if rel in by_path:
                    continue
                by_path[rel] = StatusEntry(
                    path=rel,
                    index_status=" ",
                    worktree_status=" ",
                    flow_id=None,
                    flow_name=_entry_display_name(self.repo_root, rel, repo),
                    change_kind="unchanged",
                )

        # Locks auto-managed on commit — never show in Changes UI.
        by_path.pop("flows.lock", None)
        by_path.pop("secrets.lock", None)

        # Prefer dirty first; flows then secrets then other
        def _sort_key(e: StatusEntry) -> tuple:
            dirty = 0 if e.change_kind != "unchanged" else 1
            if e.path.startswith("flows/"):
                group = 0
            elif e.path.startswith("secrets/"):
                group = 1
            else:
                group = 2
            return (dirty, group, (e.flow_name or e.path).lower())

        entries = sorted(by_path.values(), key=_sort_key)

        ahead = behind = None
        ahead_of_production = None
        has_upstream = True
        track_ref = f"origin/{branch}" if branch else None
        try:
            ref_names = [r.name for r in repo.refs]
        except Exception:  # noqa: BLE001
            ref_names = []

        if branch and prod and branch != prod:
            try:
                # Commits reachable from HEAD but not production tip (local or origin/<prod>).
                prod_tip = prod
                if f"origin/{prod}" in ref_names:
                    prod_tip = f"origin/{prod}"
                ahead_of_production = int(repo.git.rev_list("--count", f"{prod_tip}..HEAD"))
            except Exception:  # noqa: BLE001
                ahead_of_production = None

        try:
            if branch and track_ref and track_ref in ref_names:
                counts = repo.git.rev_list("--left-right", "--count", f"{track_ref}...HEAD").split()
                if len(counts) == 2:
                    behind, ahead = int(counts[0]), int(counts[1])
            elif branch:
                # Local-only branch: no origin/<branch> yet. Enable push/publish when
                # HEAD has commits to send (vs production tip, else origin/HEAD).
                has_upstream = False
                behind = 0
                if ahead_of_production is not None:
                    ahead = ahead_of_production
                else:
                    for base in ("origin/HEAD", "origin/main", "origin/master"):
                        if base == "origin/HEAD" or base in ref_names:
                            try:
                                ahead = int(repo.git.rev_list("--count", f"{base}..HEAD"))
                                break
                            except Exception:  # noqa: BLE001
                                continue
                    if ahead is None:
                        ahead = 0
        except Exception:  # noqa: BLE001
            pass
        dirty_only = [e for e in entries if e.change_kind != "unchanged"]
        return RepoStatus(
            branch=branch,
            production_branch=prod,
            on_production=bool(prod and branch == prod),
            dirty=bool(dirty_only) or repo.is_dirty(untracked_files=True),
            entries=entries,
            ahead=ahead,
            behind=behind,
            ahead_of_production=ahead_of_production,
            unresolved_conflicts=has_unresolved_conflicts(self.repo_root),
            has_upstream=has_upstream,
        )

    def diff(self, flow_id: UUID | str | None = None, *, staged: bool = False) -> str:
        repo = self._get_repo()
        if flow_id is not None:
            rel = flow_relpath_for_id(flow_id)
            return self.diff_path(rel, staged=staged)
        args: list[str] = []
        if staged:
            args.append("--cached")
        try:
            return repo.git.diff(*args)
        except Exception as exc:  # noqa: BLE001
            raise GitSotError(f"diff failed: {exc}") from exc

    def diff_path(self, rel_path: str, *, staged: bool = False) -> str:
        """Diff one path; handles untracked (new) and deleted files."""
        repo = self._get_repo()
        rel = rel_path.replace("\\", "/")
        abs_path = self.repo_root / rel
        args: list[str] = ["--", rel]
        try:
            if staged:
                out = repo.git.diff("--cached", *args)
                if (out or "").strip():
                    return out
            out = repo.git.diff(*args)
            if (out or "").strip():
                return out
            # Untracked new file
            try:
                repo.git.ls_files("--error-unmatch", rel)
            except Exception:  # noqa: BLE001
                if abs_path.is_file():
                    # Show as all-added unified diff
                    text = abs_path.read_text(encoding="utf-8", errors="replace")
                    lines = text.splitlines()
                    body = "\n".join(f"+{ln}" for ln in lines)
                    return f"diff --git a/{rel} b/{rel}\n--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{len(lines)} @@\n{body}\n"
            # Deleted from worktree but still in HEAD
            if not abs_path.exists():
                try:
                    old = repo.git.show(f"HEAD:{rel}")
                    lines = old.splitlines()
                    body = "\n".join(f"-{ln}" for ln in lines)
                    return f"diff --git a/{rel} b/{rel}\n--- a/{rel}\n+++ /dev/null\n@@ -1,{len(lines)} +0,0 @@\n{body}\n"
                except Exception:  # noqa: BLE001
                    pass
            return out or ""
        except Exception as exc:  # noqa: BLE001
            raise GitSotError(f"diff failed: {exc}") from exc

    def remote_url(self, remote: str = "origin") -> str | None:
        repo = self._get_repo()
        try:
            return repo.remotes[remote].url
        except Exception:  # noqa: BLE001
            return None

    def log(
        self,
        *,
        max_count: int = 40,
        graph: bool = False,
    ) -> dict[str, Any]:
        """Commit list with parent links for UI graph rendering."""
        repo = self._get_repo()
        max_count = max(1, min(int(max_count), 200))

        refs_by_sha: dict[str, list[str]] = {}
        try:
            for head in repo.heads:
                refs_by_sha.setdefault(head.commit.hexsha, []).append(head.name)
            if not repo.head.is_detached:
                refs_by_sha.setdefault(repo.head.commit.hexsha, [])
                if "HEAD" not in refs_by_sha[repo.head.commit.hexsha]:
                    refs_by_sha[repo.head.commit.hexsha].insert(0, "HEAD")
            for remote in repo.remotes:
                for ref in remote.refs:
                    # origin/main → keep short
                    name = ref.name  # e.g. origin/main
                    refs_by_sha.setdefault(ref.commit.hexsha, []).append(name)
        except Exception as exc:  # noqa: BLE001
            logger.debug("ref scan failed: %s", exc)

        commits: list[dict[str, Any]] = []
        try:
            # topo_order keeps children before parents so swimlane layout forks correctly.
            for c in repo.iter_commits(all=True, max_count=max_count, topo_order=True):
                commits.append(
                    {
                        "sha": c.hexsha,
                        "short_sha": c.hexsha[:8],
                        "summary": (c.summary or "").strip(),
                        "author": c.author.name if c.author else None,
                        "authored_date": c.authored_datetime.isoformat() if c.authored_datetime else None,
                        "parents": [p.hexsha for p in c.parents],
                        "refs": refs_by_sha.get(c.hexsha, []),
                    }
                )
        except TypeError:
            # Older GitPython without topo_order kw — fall back.
            try:
                for c in repo.iter_commits(all=True, max_count=max_count):
                    commits.append(
                        {
                            "sha": c.hexsha,
                            "short_sha": c.hexsha[:8],
                            "summary": (c.summary or "").strip(),
                            "author": c.author.name if c.author else None,
                            "authored_date": c.authored_datetime.isoformat() if c.authored_datetime else None,
                            "parents": [p.hexsha for p in c.parents],
                            "refs": refs_by_sha.get(c.hexsha, []),
                        }
                    )
            except Exception as exc:  # noqa: BLE001
                raise GitSotError(f"log failed: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise GitSotError(f"log failed: {exc}") from exc

        graph_lines: list[str] = []
        if graph:
            try:
                raw = repo.git.log(
                    "--graph",
                    "--oneline",
                    "--decorate",
                    f"-n{max_count}",
                    "--all",
                )
                graph_lines = [ln for ln in (raw or "").splitlines() if ln]
            except Exception as exc:  # noqa: BLE001
                logger.debug("graph log failed: %s", exc)

        return {
            "commits": commits,
            "graph_lines": graph_lines,
            "branch": self.current_branch(),
        }

    def show_commit(self, sha: str) -> dict[str, Any]:
        """Single commit metadata + changed paths for History detail modal."""
        repo = self._get_repo()
        try:
            c = repo.commit(sha)
        except Exception as exc:  # noqa: BLE001
            raise GitSotError(f"commit not found: {sha}", code="GIT_COMMIT_NOT_FOUND") from exc

        files: list[dict[str, Any]] = []
        try:
            if c.parents:
                diffs = c.parents[0].diff(c)
            else:
                git = _import_git()
                diffs = c.diff(git.NULL_TREE)
            for d in diffs:
                path = d.b_path or d.a_path
                kind = {"A": "created", "D": "deleted", "M": "modified", "R": "renamed", "C": "copied"}.get(
                    d.change_type, "modified"
                )
                files.append(
                    {
                        "path": path,
                        "change_type": d.change_type,
                        "change_kind": kind,
                        "a_path": d.a_path,
                        "b_path": d.b_path,
                    }
                )
        except Exception as exc:  # noqa: BLE001
            logger.debug("commit diff failed for %s: %s", sha, exc)

        refs: list[str] = []
        try:
            for head in repo.heads:
                if head.commit.hexsha == c.hexsha:
                    refs.append(head.name)
            if not repo.head.is_detached and repo.head.commit.hexsha == c.hexsha:
                if "HEAD" not in refs:
                    refs.insert(0, "HEAD")
        except Exception:  # noqa: BLE001
            pass

        return {
            "sha": c.hexsha,
            "short_sha": c.hexsha[:8],
            "summary": (c.summary or "").strip(),
            "message": (c.message or "").rstrip(),
            "author": c.author.name if c.author else None,
            "author_email": c.author.email if c.author else None,
            "authored_date": c.authored_datetime.isoformat() if c.authored_datetime else None,
            "parents": [p.hexsha for p in c.parents],
            "refs": refs,
            "files": files,
        }

    def discard(self, paths: list[str]) -> dict[str, Any]:
        """Discard local changes for relative paths (restore tracked / delete untracked)."""
        if not paths:
            raise GitSotError("paths required", code="GIT_PATHS_REQUIRED")
        repo = self._get_repo()
        normalized = [_normalize_repo_relpath(self.repo_root, p) for p in paths]
        _guard_paths(normalized)

        discarded: list[str] = []
        errors: list[dict[str, str]] = []
        for p in normalized:
            if p.replace("\\", "/").lstrip("./") == "flows.lock":
                errors.append({"path": p, "error": "flows.lock is managed automatically"})
                continue
            abs_path = self.repo_root / p
            try:
                tracked = True
                try:
                    repo.git.ls_files("--error-unmatch", p)
                except Exception:  # noqa: BLE001
                    tracked = False

                if tracked:
                    # Unstage then restore worktree from HEAD (covers modify + delete).
                    try:
                        repo.git.restore("--staged", "--worktree", "--", p)
                    except Exception:  # noqa: BLE001
                        repo.git.checkout("HEAD", "--", p)
                else:
                    if abs_path.is_file():
                        abs_path.unlink()
                    elif abs_path.is_dir():
                        raise GitSotError(
                            f"Refuse discard directory: {p}",
                            code="GIT_DISCARD_DIR",
                        )
                    # missing untracked path → already gone
                discarded.append(p)
            except GitSotError:
                raise
            except Exception as exc:  # noqa: BLE001
                errors.append({"path": p, "error": str(exc)})

        # Keep flows.lock aligned with HEAD for discarded flow ids only.
        if discarded:
            try:
                head_raw = repo.git.show("HEAD:flows.lock")
            except Exception:  # noqa: BLE001
                head_raw = None
            try:
                disk_lock = read_lock(self.repo_root)
            except Exception:  # noqa: BLE001
                disk_lock = lock_from_git_blob(None)
            write_lock(
                self.repo_root,
                restore_selected_paths_in_lock(
                    disk_lock,
                    lock_from_git_blob(head_raw),
                    discarded,
                ),
            )

        ok = not errors
        append_ops_log(
            self.repo_root,
            op="discard",
            ok=ok,
            detail={"discarded": discarded, "errors": errors},
            error=None if ok else f"{len(errors)} path(s) failed",
        )
        if errors and not discarded:
            raise GitSotError(
                f"discard failed: {errors[0]['error']}",
                code="GIT_DISCARD_FAILED",
            )
        return {"discarded": discarded, "errors": errors}

    def is_whitespace_only_change(self, paths: list[str]) -> bool:
        """True when ``git diff -w`` (and untracked check) shows nothing meaningful."""
        repo = self._get_repo()
        tracked = [p for p in paths if (self.repo_root / p).exists()]
        if not tracked:
            return False
        try:
            # untracked new files are never whitespace-only
            for p in tracked:
                try:
                    repo.git.ls_files("--error-unmatch", p)
                except Exception:  # noqa: BLE001
                    return False
            out = repo.git.diff("-w", "--", *tracked)
            staged = repo.git.diff("-w", "--cached", "--", *tracked)
            return not (out or "").strip() and not (staged or "").strip()
        except Exception:  # noqa: BLE001
            return False

    # --- write ops ---------------------------------------------------------

    def commit(
        self,
        paths: list[str] | None,
        message: str,
        *,
        author_name: str | None = None,
        author_email: str | None = None,
        allow_empty: bool = False,
        skip_whitespace_only: bool = False,
    ) -> dict[str, Any]:
        repo = self._get_repo()
        _guard_paths(paths)
        if paths and skip_whitespace_only and self.is_whitespace_only_change(paths):
            append_ops_log(
                self.repo_root,
                op="commit",
                ok=True,
                detail={"skipped": "whitespace_only", "paths": paths},
            )
            return {"skipped": True, "reason": "whitespace_only", "hexsha": None}

        # Phase S fail-closed stub: block commit if raw key patterns in flows/*.json
        try:
            assert_no_raw_secret_patterns(self.repo_root, paths)
        except SecretPatternBlockedError as exc:
            append_ops_log(
                self.repo_root,
                op="commit",
                ok=False,
                error=str(exc),
                detail={"code": exc.code, "paths": paths},
            )
            raise

        try:
            if paths:
                staging = [
                    _normalize_repo_relpath(self.repo_root, p)
                    for p in paths
                    if p.replace("\\", "/").lstrip("./") not in ("flows.lock", "secrets.lock")
                ]
                _guard_paths(staging)
                for p in staging:
                    assert_not_immutable_path(p)

                # Surgical flows.lock: start from HEAD, apply only selected flow paths.
                try:
                    head_raw = repo.git.show("HEAD:flows.lock")
                except Exception:  # noqa: BLE001
                    head_raw = None
                commit_lock = apply_selected_paths_to_lock(
                    lock_from_git_blob(head_raw),
                    self.repo_root,
                    staging,
                )
                write_lock(self.repo_root, commit_lock)

                from langflow.services.flow_git.secrets_store import (
                    apply_selected_paths_to_secrets_lock,
                    ensure_secrets_layout,
                    secrets_lock_from_git_blob,
                    write_secrets_lock,
                )

                ensure_secrets_layout(self.repo_root)
                try:
                    head_secrets = repo.git.show("HEAD:secrets.lock")
                except Exception:  # noqa: BLE001
                    head_secrets = None
                secrets_lock = apply_selected_paths_to_secrets_lock(
                    secrets_lock_from_git_blob(head_secrets),
                    self.repo_root,
                    staging,
                )
                write_secrets_lock(self.repo_root, secrets_lock)

                staging_with_lock = [*staging, "flows.lock", "secrets.lock"]

                missing = [p for p in staging_with_lock if not (self.repo_root / p).exists()]
                present = [p for p in staging_with_lock if (self.repo_root / p).exists()]
                if present:
                    repo.git.add("--", *present)
                for p in missing:
                    tracked = True
                    try:
                        repo.git.ls_files("--error-unmatch", p)
                    except Exception:  # noqa: BLE001
                        tracked = False
                    if not tracked:
                        continue
                    try:
                        repo.git.rm("--", p)
                    except Exception:  # noqa: BLE001
                        repo.git.update_index("--force-remove", "--", p)
                paths = staging_with_lock
            else:
                # add all except ensure production-branch stays as-is (already committed)
                repo.git.add("-A")
                # If someone deleted production-branch from index, restore it
                prod = read_production_branch(self.repo_root)
                if prod is None:
                    ensure_production_branch_file(self.repo_root)

            if not allow_empty and not repo.is_dirty() and not repo.index.diff("HEAD"):
                # also check staged
                if not repo.index.diff("HEAD"):
                    append_ops_log(self.repo_root, op="commit", ok=True, detail={"skipped": "clean"})
                    return {"skipped": True, "reason": "clean", "hexsha": None}

            actor = None
            if author_name or author_email:
                git = _import_git()
                actor = git.Actor(author_name or "Langflow Desktop", author_email or "desktop@localhost")

            kwargs: dict[str, Any] = {}
            if actor:
                kwargs["author"] = actor
                kwargs["committer"] = actor
            commit = repo.index.commit(message, **kwargs)
            append_ops_log(
                self.repo_root,
                op="commit",
                ok=True,
                detail={"hexsha": commit.hexsha, "message": message, "paths": paths},
            )
            return {"skipped": False, "hexsha": commit.hexsha, "message": message}
        except ImmutablePathError:
            raise
        except Exception as exc:  # noqa: BLE001
            append_ops_log(self.repo_root, op="commit", ok=False, error=str(exc))
            raise GitSotError(f"commit failed: {exc}") from exc

    def list_branches(self) -> list[dict[str, Any]]:
        repo = self._get_repo()
        current = self.current_branch()
        prod = self.production_branch()
        try:
            ref_names = {r.name for r in repo.refs}
        except Exception:  # noqa: BLE001
            ref_names = set()

        out: list[dict[str, Any]] = []
        for b in repo.branches:
            ahead: int | None = None
            behind: int | None = None
            track = f"origin/{b.name}"
            if track in ref_names:
                try:
                    counts = repo.git.rev_list(
                        "--left-right",
                        "--count",
                        f"{track}...{b.name}",
                    ).split()
                    # left = commits on track not in local; right = local not in track
                    behind, ahead = int(counts[0]), int(counts[1])
                except Exception:  # noqa: BLE001
                    ahead = behind = None
            out.append(
                {
                    "name": b.name,
                    "current": b.name == current,
                    "is_production": b.name == prod,
                    "remote": False,
                    "commit": b.commit.hexsha[:12],
                    "ahead": ahead,
                    "behind": behind,
                    "has_upstream": track in ref_names,
                }
            )
        # Remote-tracking refs (origin/*) — useful for create-from and checkout.
        try:
            for ref in repo.refs:
                rname = getattr(ref, "name", "") or ""
                if not rname.startswith("origin/"):
                    continue
                if rname.endswith("/HEAD") or rname == "origin/HEAD":
                    continue
                out.append(
                    {
                        "name": rname,
                        "current": False,
                        "is_production": rname == f"origin/{prod}" if prod else False,
                        "remote": True,
                        "commit": ref.commit.hexsha[:12],
                        "ahead": None,
                        "behind": None,
                        "has_upstream": True,
                    }
                )
        except Exception:  # noqa: BLE001
            pass
        return out

    def create_branch(
        self,
        name: str,
        *,
        checkout: bool = False,
        start_point: str | None = None,
    ) -> dict[str, Any]:
        repo = self._get_repo()
        prod = self.production_branch()
        if prod and name == prod:
            # creating local tracking of prod is OK; just note
            pass
        if name in [b.name for b in repo.branches]:
            raise GitSotError(f"Branch already exists: {name}", code="GIT_BRANCH_EXISTS")
        tip = (start_point or "").strip() or None
        if tip:
            try:
                repo.rev_parse(tip)
            except Exception as exc:  # noqa: BLE001
                raise GitSotError(
                    f"Unknown start point: {tip}",
                    code="GIT_START_POINT_INVALID",
                ) from exc
            branch = repo.create_head(name, tip)
        else:
            branch = repo.create_head(name)
        if checkout:
            self.checkout(name, force=False)
        append_ops_log(
            self.repo_root,
            op="create_branch",
            ok=True,
            detail={"name": name, "start_point": tip},
        )
        return {"name": branch.name, "commit": branch.commit.hexsha, "start_point": tip}

    def checkout(self, name: str, *, force: bool = False) -> dict[str, Any]:
        repo = self._get_repo()
        dirty = self.is_dirty()
        assert_checkout_allowed_dirty(dirty=dirty, force=force)
        target = name.strip()
        try:
            local_names = {b.name for b in repo.branches}
            remote_names = set()
            try:
                for ref in repo.refs:
                    rname = getattr(ref, "name", "") or ""
                    if rname.startswith("origin/") and not rname.endswith("/HEAD") and rname != "origin/HEAD":
                        remote_names.add(rname)
            except Exception:  # noqa: BLE001
                pass

            # origin/foo → local foo (create tracking branch if missing)
            if target.startswith("origin/"):
                local = target.split("/", 1)[1]
                if local in local_names:
                    target = local
                    repo.git.checkout(target)
                else:
                    repo.git.checkout("-b", local, "--track", target)
                    target = local
            elif target in local_names:
                repo.git.checkout(target)
            elif f"origin/{target}" in remote_names:
                # Standard: checkout remote-only branch via new local tracking branch
                repo.git.checkout("-b", target, "--track", f"origin/{target}")
            else:
                repo.git.checkout(target)
        except Exception as exc:  # noqa: BLE001
            if dirty and not force:
                raise DirtyWorktreeError(str(exc)) from exc
            raise GitSotError(f"checkout failed: {exc}") from exc

        from langflow.services.flow_git.setup import keys_age_path

        if not keys_age_path(self.repo_root).is_file():
            from langflow.services.flow_git.exceptions import GitKeysAgeMissingError

            raise GitKeysAgeMissingError(
                f"Mandatory file missing on branch '{target}': {keys_age_path(self.repo_root).relative_to(self.repo_root)}",
            )

        append_ops_log(self.repo_root, op="checkout", ok=True, detail={"name": target, "force": force})
        return {"branch": self.current_branch()}

    def delete_branch(self, name: str, *, force: bool = False) -> dict[str, Any]:
        prod = self.production_branch()
        if prod and name == prod:
            from langflow.services.flow_git.exceptions import ProductionBranchGuardError

            raise ProductionBranchGuardError(f"Refuse delete production branch '{prod}'")
        if name == self.current_branch():
            raise GitSotError("Cannot delete current branch", code="GIT_DELETE_CURRENT")
        if name.startswith("origin/"):
            raise GitSotError("Refuse delete remote-tracking ref from UI", code="GIT_DELETE_REMOTE")
        repo = self._get_repo()
        try:
            repo.delete_head(name, force=force)
        except Exception as exc:  # noqa: BLE001
            raise GitSotError(f"delete branch failed: {exc}") from exc
        append_ops_log(self.repo_root, op="delete_branch", ok=True, detail={"name": name})
        return {"deleted": name}

    def sync_branches_from_remote(self, remote: str = "origin", *, token: str | None = None) -> dict[str, Any]:
        """Wipe all local branches except current, then fetch --prune from *remote*."""
        repo = self._get_repo()
        current = self.current_branch()
        if not current:
            raise GitSotError("Detached HEAD — checkout a branch before sync", code="GIT_DETACHED")

        deleted: list[str] = []
        errors: list[str] = []
        for branch in list(repo.branches):
            if branch.name == current:
                continue
            try:
                # Force: sync intentionally resets local branch set to match remote fetch
                repo.git.branch("-D", branch.name)
                deleted.append(branch.name)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{branch.name}: {exc}")

        fetch_result = self.fetch(remote, token=token, prune=True)
        append_ops_log(
            self.repo_root,
            op="sync_branches",
            ok=not errors,
            detail={"kept": current, "deleted": deleted, "errors": errors, "remote": remote},
        )
        return {
            "ok": not errors,
            "kept": current,
            "deleted": deleted,
            "errors": errors,
            "fetch": fetch_result,
        }

    def fetch(self, remote: str = "origin", *, token: str | None = None, prune: bool = False) -> dict[str, Any]:
        repo = self._get_repo()
        token = token or load_pat()
        try:
            if token:
                url = repo.remotes[remote].url
                auth = _auth_url(url, token)
                args = ["--prune"] if prune else []
                # Fetch by authenticated URL without rewriting remote permanently
                repo.git.fetch(*args, auth, f"+refs/heads/*:refs/remotes/{remote}/*")
            elif prune:
                repo.git.fetch("--prune", remote)
            else:
                repo.remotes[remote].fetch()
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            append_ops_log(self.repo_root, op="fetch", ok=False, error=msg)
            if "Authentication" in msg or "401" in msg or "403" in msg:
                raise GitAuthError(msg) from exc
            raise GitSotError(f"fetch failed: {msg}") from exc
        append_ops_log(
            self.repo_root,
            op="fetch",
            ok=True,
            detail={"remote": remote, "prune": prune},
        )
        return {"remote": remote, "ok": True, "prune": prune}

    def pull(
        self,
        *,
        remote: str = "origin",
        strategy: str = "merge",
        token: str | None = None,
    ) -> dict[str, Any]:
        """Pull with merge (default), ff-only, or rebase. Conflicts → store, no silent JSON merge."""
        repo = self._get_repo()
        branch = self.current_branch()
        token = token or load_pat()
        # fetch first
        self.fetch(remote, token=token)
        if not branch:
            raise GitSotError("Detached HEAD — cannot pull", code="GIT_DETACHED")

        try:
            if strategy == "ff-only":
                repo.git.merge("--ff-only", f"{remote}/{branch}")
            elif strategy == "rebase":
                repo.git.rebase(f"{remote}/{branch}")
            else:
                repo.git.merge(f"{remote}/{branch}")
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            conflicted = self._collect_unmerged()
            if conflicted or "CONFLICT" in msg.upper() or "conflict" in msg.lower():
                self._materialize_conflicts(conflicted, reason="pull_merge")
                append_ops_log(
                    self.repo_root,
                    op="pull",
                    ok=False,
                    error=msg,
                    detail={"conflicts": conflicted, "strategy": strategy},
                )
                raise GitConflictError(
                    f"Pull produced conflicts on flows: {conflicted}. Resolve via conflict UI; no auto-merge.",
                ) from exc
            append_ops_log(self.repo_root, op="pull", ok=False, error=msg)
            raise GitSotError(f"pull failed: {msg}") from exc

        append_ops_log(self.repo_root, op="pull", ok=True, detail={"strategy": strategy, "branch": branch})
        return {
            "ok": True,
            "strategy": strategy,
            "branch": branch,
            "conflicts": list_conflicts(self.repo_root),
        }

    def prepare_mr_merge(self, *, source_branch: str, target_branch: str) -> dict[str, Any]:
        """Checkout source, merge ``origin/target`` into it. Return conflict paths if any.

        Used by MR conflict resolver — merge target into source so push makes MR mergeable.
        """
        source = (source_branch or "").strip()
        target = (target_branch or "").strip()
        if not source or not target:
            raise GitSotError("source_branch and target_branch required", code="VALIDATION")
        if source == target:
            raise GitSotError("source and target must differ", code="VALIDATION")

        self.fetch(prune=True)
        self.checkout(source, create=False)

        repo = self._get_repo()
        merge_head = Path(repo.git_dir) / "MERGE_HEAD"
        if merge_head.is_file():
            unmerged = self.list_unmerged_paths()
            return {
                "ok": not bool(unmerged),
                "has_conflicts": bool(unmerged),
                "conflict_paths": unmerged,
                "source_branch": source,
                "target_branch": target,
                "message": "Merge already in progress",
            }

        try:
            repo.git.merge(f"origin/{target}", "--no-edit")
        except Exception as exc:  # noqa: BLE001 — GitCommandError / merge conflicts
            msg = str(exc)
            unmerged = self.list_unmerged_paths()
            if unmerged or "conflict" in msg.lower() or "CONFLICT" in msg:
                return {
                    "ok": False,
                    "has_conflicts": True,
                    "conflict_paths": unmerged or self._collect_unmerged(),
                    "source_branch": source,
                    "target_branch": target,
                    "message": "Merge conflicts — resolve then commit and push source",
                }
            raise GitSotError(f"prepare merge failed: {msg}") from exc

        return {
            "ok": True,
            "has_conflicts": False,
            "conflict_paths": [],
            "source_branch": source,
            "target_branch": target,
            "message": "Already mergeable locally (no conflicts)",
        }

    def list_unmerged_paths(self) -> list[str]:
        repo = self._get_repo()
        try:
            out = repo.git.diff("--name-only", "--diff-filter=U")
        except Exception:  # noqa: BLE001
            return self._collect_unmerged()
        paths = [ln.strip() for ln in (out or "").splitlines() if ln.strip()]
        return paths or self._collect_unmerged()

    def conflict_file_sides(self, path: str) -> dict[str, Any]:
        """Return ours (source) / theirs (target) / base / working for an unmerged path."""
        rel = (path or "").strip().lstrip("/")
        if not rel or ".." in rel:
            raise GitSotError("invalid path", code="VALIDATION")
        repo = self._get_repo()
        full = self.repo_root / rel

        def _show_stage(stage: int) -> str | None:
            try:
                return repo.git.show(f":{stage}:{rel}")
            except Exception:  # noqa: BLE001
                return None

        ours = _show_stage(2)
        theirs = _show_stage(3)
        base = _show_stage(1)
        working = full.read_text(encoding="utf-8") if full.is_file() else None
        return {
            "path": rel,
            "ours": ours,  # source branch (checked out)
            "theirs": theirs,  # target branch being merged in
            "base": base,
            "working": working,
            "exists": full.exists(),
        }

    def write_resolved_path(self, path: str, content: str) -> dict[str, Any]:
        """Write resolved file content and ``git add`` it."""
        rel = (path or "").strip().lstrip("/")
        if not rel or ".." in rel:
            raise GitSotError("invalid path", code="VALIDATION")
        full = self.repo_root / rel
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content if content is not None else "", encoding="utf-8")
        repo = self._get_repo()
        repo.git.add("--", rel)
        remaining = self.list_unmerged_paths()
        return {"ok": True, "path": rel, "remaining": remaining}

    def abort_mr_merge(self) -> dict[str, Any]:
        repo = self._get_repo()
        try:
            repo.git.merge("--abort")
        except Exception as exc:  # noqa: BLE001
            raise GitSotError(f"merge --abort failed: {exc}") from exc
        return {"ok": True}

    def commit_merge_resolution(self, message: str) -> dict[str, Any]:
        """Finish in-progress merge after all conflicts resolved."""
        remaining = self.list_unmerged_paths()
        if remaining:
            raise GitConflictError(f"Still unresolved: {remaining}")
        msg = (message or "").strip() or "Resolve merge conflicts"
        repo = self._get_repo()
        try:
            merge_head = Path(repo.git_dir) / "MERGE_HEAD"
            if merge_head.is_file():
                repo.git.commit("-m", msg)
            else:
                repo.git.commit("-am", msg)
        except Exception as exc:  # noqa: BLE001
            if "nothing to commit" in str(exc).lower():
                sha = repo.head.commit.hexsha if repo.head.is_valid() else None
                return {"ok": True, "sha": sha, "message": "nothing to commit"}
            raise GitSotError(f"commit failed: {exc}") from exc
        return {"ok": True, "sha": repo.head.commit.hexsha, "message": msg}

    def push(
        self,
        *,
        remote: str = "origin",
        branch: str | None = None,
        token: str | None = None,
        set_upstream: bool = True,
    ) -> dict[str, Any]:
        """Push with auth. Never called by auto-commit."""
        if has_unresolved_conflicts(self.repo_root):
            raise GitConflictError("Unresolved conflicts under .langflow/conflicts/ — resolve before push")

        head = branch or self.current_branch()

        repo = self._get_repo()
        token = token or load_pat()
        try:
            if token:
                url = repo.remotes[remote].url
                auth = _auth_url(url, token)
                # Never `git push --set-upstream <auth_url> <branch>`:
                # that leaves refs/remotes/origin/* stale and rewrites
                # branch.<name>.merge to the credential URL.
                refspec = f"refs/heads/{head}:refs/heads/{head}"
                repo.git.push(auth, refspec)
                # Refresh remote-tracking so ahead/behind reflect remote tip.
                repo.git.fetch(auth, f"+refs/heads/{head}:refs/remotes/{remote}/{head}")
                if set_upstream and head:
                    try:
                        repo.git.branch("--set-upstream-to", f"{remote}/{head}", head)
                    except Exception as upexc:  # noqa: BLE001
                        logger.debug("set-upstream-to failed: %s", upexc)
            elif set_upstream:
                repo.git.push("--set-upstream", remote, head)
            else:
                repo.remotes[remote].push(head)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            append_ops_log(self.repo_root, op="push", ok=False, error=msg, detail={"branch": head})
            if "rejected" in msg.lower() or "non-fast-forward" in msg.lower() or "fetch first" in msg.lower():
                # fetch + list remote tip conflicts for UI
                try:
                    self.fetch(remote, token=token)
                except Exception:  # noqa: BLE001
                    pass
                conflicted = self._diff_flow_ids_vs_remote(remote, head)
                for fid in conflicted:
                    path = flow_path_for_id(self.repo_root, fid)
                    ours = path.read_bytes() if path.exists() else None
                    theirs = self._show_remote_file(remote, head, flow_relpath_for_id(fid))
                    store_conflict(
                        self.repo_root,
                        fid,
                        ours_bytes=ours,
                        theirs_bytes=theirs,
                        reason="push_non_ff",
                    )
                raise GitPushRejectedError(
                    f"Push rejected (non-ff). Fetched remote. Conflicted flows: {conflicted}",
                ) from exc
            if "Authentication" in msg or "401" in msg or "403" in msg:
                raise GitAuthError(msg) from exc
            raise GitSotError(f"push failed: {msg}") from exc

        append_ops_log(self.repo_root, op="push", ok=True, detail={"remote": remote, "branch": head})
        return {"ok": True, "remote": remote, "branch": head}

    # --- conflict helpers --------------------------------------------------

    def _collect_unmerged(self) -> list[str]:
        repo = self._get_repo()
        try:
            raw = repo.git.diff("--name-only", "--diff-filter=U")
        except Exception:  # noqa: BLE001
            return []
        return [ln.strip() for ln in (raw or "").splitlines() if ln.strip()]

    def _materialize_conflicts(self, paths: list[str], *, reason: str) -> None:
        repo = self._get_repo()
        for fid in flow_ids_from_unmerged_paths(paths):
            rel = flow_relpath_for_id(fid)
            ours = theirs = base = None
            try:
                ours = repo.git.show(f":2:{rel}").encode("utf-8")
            except Exception:  # noqa: BLE001
                p = flow_path_for_id(self.repo_root, fid)
                if p.exists():
                    ours = p.read_bytes()
            try:
                theirs = repo.git.show(f":3:{rel}").encode("utf-8")
            except Exception:  # noqa: BLE001
                pass
            try:
                base = repo.git.show(f":1:{rel}").encode("utf-8")
            except Exception:  # noqa: BLE001
                pass
            store_conflict(
                self.repo_root,
                fid,
                ours_bytes=ours,
                theirs_bytes=theirs,
                base_bytes=base,
                reason=reason,
            )

    def _diff_flow_ids_vs_remote(self, remote: str, branch: str | None) -> list[str]:
        if not branch:
            return []
        repo = self._get_repo()
        try:
            raw = repo.git.diff("--name-only", f"HEAD...{remote}/{branch}", "--", "flows/")
        except Exception:  # noqa: BLE001
            return []
        return flow_ids_from_unmerged_paths([ln.strip() for ln in (raw or "").splitlines() if ln.strip()])

    def _show_remote_file(self, remote: str, branch: str | None, rel: str) -> bytes | None:
        if not branch:
            return None
        repo = self._get_repo()
        try:
            return repo.git.show(f"{remote}/{branch}:{rel}").encode("utf-8")
        except Exception:  # noqa: BLE001
            return None


def get_git_repo_service(repo_root: Path | str | None = None) -> GitRepoService | None:
    """Return service for configured git_flows_dir, or *repo_root* override."""
    if repo_root is None:
        from langflow.services.flow_git.store import get_flow_git_store, is_git_sot_enabled

        if not is_git_sot_enabled():
            return None
        store = get_flow_git_store()
        if store is None:
            return None
        repo_root = store.repo_root
    root = Path(repo_root)
    if not (root / ".git").exists():
        return None
    try:
        return GitRepoService.open(root)
    except GitRepoNotFoundError:
        return None
