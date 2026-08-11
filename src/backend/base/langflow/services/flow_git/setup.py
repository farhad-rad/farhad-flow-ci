"""Runtime git install wizard helpers (no LANGFLOW_GIT_FLOWS_DIR required)."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Literal

from langflow.services.flow_git.lockfile import lock_path, read_lock, write_lock
from langflow.services.flow_git.paths import flows_subdir
from langflow.services.flow_git.production_branch import (
    production_branch_path,
    read_production_branch,
)
from langflow.services.flow_git.secrets_store import (
    ensure_secrets_layout,
    secrets_lock_path,
    secrets_subdir,
)

logger = logging.getLogger("langflow.flow_git")

FLOWS_REPO_DIRNAME = "flows-repo"
KEYS_AGE_REL = ".langflow/keys.age"
LANGFLOW_DIRNAME = ".langflow"


def keys_age_path(repo_root: Path) -> Path:
    return Path(repo_root) / ".langflow" / "keys.age"


def langflow_dir(repo_root: Path) -> Path:
    return Path(repo_root) / LANGFLOW_DIRNAME


def resolve_git_flows_dir() -> Path | None:
    """Resolve flows repo root: explicit setting, else ``{config_dir}/flows-repo``."""
    from langflow.services.deps import get_settings_service

    settings = get_settings_service().settings
    if not getattr(settings, "git_enabled", False):
        return None

    explicit = getattr(settings, "git_flows_dir", None)
    if explicit:
        return Path(str(explicit)).expanduser().resolve()

    config_dir = getattr(settings, "config_dir", None)
    if not config_dir:
        logger.warning("git enabled but config_dir unset — cannot resolve flows-repo path")
        return None
    return (Path(str(config_dir)).expanduser().resolve() / FLOWS_REPO_DIRNAME)


def validate_repo_layout(repo_root: Path | None) -> dict[str, Any]:
    """Return layout checks used by setup wizard / health."""
    if repo_root is None:
        return {
            "ready": False,
            "repo_root": None,
            "checks": {
                "path_resolved": False,
                "is_git": False,
                "langflow_dir": False,
                "keys_age": False,
                "flows_dir": False,
                "flows_lock": False,
                "production_branch": False,
                "secrets_dir": False,
                "secrets_lock": False,
            },
            "missing": ["path_resolved"],
            "production_branch": None,
        }

    root = Path(repo_root).expanduser().resolve()

    checks = {
        "path_resolved": True,
        "is_git": (root / ".git").exists(),
        "langflow_dir": langflow_dir(root).is_dir(),
        "keys_age": keys_age_path(root).is_file(),
        "flows_dir": flows_subdir(root).is_dir(),
        "flows_lock": lock_path(root).is_file(),
        "production_branch": production_branch_path(root).is_file()
        and bool(read_production_branch(root)),
        "secrets_dir": secrets_subdir(root).is_dir(),
        "secrets_lock": secrets_lock_path(root).is_file(),
    }
    mandatory = ("is_git", "langflow_dir", "keys_age", "production_branch")
    missing = [name for name in mandatory if not checks.get(name)]
    optional_missing = [
        name
        for name in ("flows_dir", "flows_lock", "secrets_dir", "secrets_lock")
        if not checks.get(name)
    ]
    return {
        "ready": len(missing) == 0,
        "repo_root": str(root),
        "checks": checks,
        "missing": missing,
        "optional_missing": optional_missing,
        "production_branch": read_production_branch(root),
    }


def _scaffold_optional_dirs(root: Path, *, repaired: list[str]) -> None:
    flows = flows_subdir(root)
    if not flows.is_dir():
        flows.mkdir(parents=True, exist_ok=True)
        repaired.append("flows_dir")

    if not lock_path(root).is_file():
        write_lock(root, read_lock(root))
        repaired.append("flows_lock")

    before_secrets = secrets_subdir(root).is_dir()
    ensure_secrets_layout(root)
    if not before_secrets:
        repaired.append("secrets_dir")

    if secrets_lock_path(root).is_file() and "secrets_lock" not in repaired:
        if "secrets_dir" in repaired:
            repaired.append("secrets_lock")


def ensure_repo_layout(
    repo_root: Path,
    *,
    mode: Literal["existing", "fresh"] = "existing",
    keys_age_blob: bytes | None = None,
    production_branch: str = "main",
) -> dict[str, Any]:
    """Scaffold optional dirs; fresh mode writes mandatory ``.langflow/`` files."""
    root = Path(repo_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    repaired: list[str] = []

    if mode == "fresh":
        lf = langflow_dir(root)
        lf.mkdir(parents=True, exist_ok=True)
        pb_path = production_branch_path(root)
        if not pb_path.is_file():
            pb_path.write_text(production_branch + "\n", encoding="utf-8", newline="\n")
            repaired.append("production_branch")
        ka_path = keys_age_path(root)
        if keys_age_blob is not None and not ka_path.is_file():
            ka_path.write_bytes(keys_age_blob)
            repaired.append("keys_age")
        elif keys_age_blob is not None:
            ka_path.write_bytes(keys_age_blob)
            repaired.append("keys_age")

    _scaffold_optional_dirs(root, repaired=repaired)

    layout = validate_repo_layout(root)
    layout["repaired"] = repaired
    layout["mode"] = mode
    return layout


def assert_mandatory_layout(root: Path) -> None:
    """Fail fast when mandatory ``.langflow/`` files missing (existing repos)."""
    layout = validate_repo_layout(root)
    missing = layout.get("missing") or []
    if missing:
        from langflow.services.flow_git.exceptions import GitSotError

        raise GitSotError(
            f"Repository layout invalid — missing: {', '.join(missing)}",
            code="GIT_LAYOUT_INVALID",
        )


def validate_remote_branch(
    host: str,
    project_id: int | str,
    branch: str,
    token: str | None = None,
) -> dict[str, Any]:
    """GitLab API check: mandatory ``.langflow/`` files exist on *branch*."""
    from langflow.services.flow_git.gitlab_client import GitLabClient

    client = GitLabClient.from_host(host, token=token)
    ref = (branch or "").strip()
    if not ref:
        from langflow.services.flow_git.exceptions import GitSotError

        raise GitSotError("Branch name required", code="GIT_BRANCH_REQUIRED")

    checks: dict[str, bool] = {}
    for rel in (".langflow/production-branch", KEYS_AGE_REL):
        checks[rel] = client.file_exists(project_id, rel, ref=ref)

    missing = [path for path, ok in checks.items() if not ok]
    return {
        "ok": len(missing) == 0,
        "branch": ref,
        "project_id": project_id,
        "checks": checks,
        "missing": missing,
    }


def is_git_setup_complete() -> bool:
    from langflow.services.flow_git.age_keys import keys_unlocked

    layout_ok = bool(validate_repo_layout(resolve_git_flows_dir()).get("ready"))
    return layout_ok and keys_unlocked()


def prepare_clone_dest(dest: Path, *, force: bool = False) -> None:
    """Ensure *dest* is usable for ``git clone`` (empty or non-existent).

    Non-git managed folder under flows-repo may contain empty scaffold from
    store open — wipe that automatically. Refuse when other content exists
    unless *force*.
    """
    dest = Path(dest).expanduser().resolve()
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        return
    if (dest / ".git").exists() and not force:
        return
    kids = list(dest.iterdir()) if dest.is_dir() else []
    if not kids:
        return

    def _emptyish_nongit() -> bool:
        if (dest / ".git").exists():
            return False
        flows = dest / "flows"
        if flows.is_dir() and any(flows.glob("*.json")):
            return False
        # allow wiping empty scaffold (flows/, stray files without flow JSON)
        return True

    if force or _emptyish_nongit():
        shutil.rmtree(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        return

    msg = (
        f"Clone destination not empty: {dest}. "
        "Clear it first or pass force=true to replace."
    )
    raise FileExistsError(msg)
