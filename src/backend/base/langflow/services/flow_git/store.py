"""FlowGitStore — disk SoT operations (no git bindings in Phase 2)."""

from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from langflow.services.flow_git.atomic import atomic_write
from langflow.services.flow_git.auto_commit import maybe_auto_commit
from langflow.services.flow_git.canonical import canonical_json_bytes, flow_to_export_dict, sha256_raw
from langflow.services.flow_git.lockfile import (
    assert_lock_matches_tree,
    read_lock,
    write_lock,
)
from langflow.services.flow_git.paths import (
    PathJailError,
    assert_under_jail,
    flow_path_for_id,
    flow_relpath_for_id,
    flows_subdir,
    win_long_path,
)

logger = logging.getLogger("langflow.flow_git")


def _trash_dir(repo_root: Path) -> Path:
    return Path(repo_root) / ".langflow" / "trash"


@dataclass(frozen=True)
class DriftResult:
    drifted: bool
    db_sha256: str | None
    disk_sha256: str | None
    has_disk_file: bool


class FlowGitStore:
    """Owns ``<repo>/flows/<uuid>.json`` + ``flows.lock`` under a jailable root."""

    def __init__(self, repo_root: Path | str, *, auto_commit: bool = False) -> None:
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.auto_commit = auto_commit
        self.repo_root.mkdir(parents=True, exist_ok=True)
        flows_subdir(self.repo_root).mkdir(parents=True, exist_ok=True)

    def flow_path_for_id(self, flow_id: UUID | str) -> Path:
        return flow_path_for_id(self.repo_root, flow_id)

    def fs_path_for_id(self, flow_id: UUID | str) -> str:
        """Absolute path string to store on ``Flow.fs_path``."""
        return str(self.flow_path_for_id(flow_id))

    def list_flow_files(self) -> list[Path]:
        flows = flows_subdir(self.repo_root)
        if not flows.is_dir():
            return []
        return sorted(p for p in flows.glob("*.json") if p.is_file())

    def read_flow_file(self, flow_id: UUID | str) -> dict[str, Any]:
        path = self.flow_path_for_id(flow_id)
        if not path.exists():
            msg = f"flow file missing: {path}"
            raise FileNotFoundError(msg)
        raw = win_long_path(path).read_bytes()
        return json.loads(raw.decode("utf-8"))

    def read_flow_bytes(self, flow_id: UUID | str) -> bytes:
        path = self.flow_path_for_id(flow_id)
        return win_long_path(path).read_bytes()

    def write_flow(self, flow: Any) -> str:
        """Canonicalize + atomic write + update lock. Returns sha256 hex."""
        payload = flow_to_export_dict(flow)
        flow_id = payload.get("id")
        if not flow_id:
            msg = "flow.id required for git store write"
            raise ValueError(msg)
        data = canonical_json_bytes(payload)
        digest = sha256_raw(data)
        path = self.flow_path_for_id(flow_id)
        atomic_write(path, data)
        rel = flow_relpath_for_id(flow_id)
        lock = read_lock(self.repo_root)
        lock.set_flow(flow_id, rel_path=rel, sha256=digest)
        write_lock(self.repo_root, lock)
        logger.info("flow_git write_flow id=%s sha256=%s path=%s", flow_id, digest, path)
        maybe_auto_commit(
            repo_root=self.repo_root,
            flow_id=flow_id,
            flow_name=payload.get("name"),
            paths=[rel, "flows.lock"],
            enabled=self.auto_commit,
        )
        return digest

    def _backup_to_trash(self, path: Path, flow_id: UUID | str) -> Path | None:
        """Copy flow JSON into ``.langflow/trash/`` before delete. Returns trash path or None."""
        if not path.exists():
            return None
        trash = _trash_dir(self.repo_root)
        trash.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dest = trash / f"{flow_id}.{stamp}.json"
        # Avoid clobber if same-second double delete
        n = 0
        while dest.exists():
            n += 1
            dest = trash / f"{flow_id}.{stamp}.{n}.json"
        shutil.copy2(win_long_path(path), win_long_path(dest))
        logger.info("flow_git trash backup id=%s trash=%s", flow_id, dest)
        return dest

    def delete_flow(self, flow_id: UUID | str) -> None:
        path = self.flow_path_for_id(flow_id)
        if path.exists():
            try:
                self._backup_to_trash(path, flow_id)
            except OSError as exc:
                logger.warning("flow_git trash backup failed id=%s: %s", flow_id, exc)
            win_long_path(path).unlink()
            logger.info("flow_git delete_flow id=%s path=%s", flow_id, path)
        lock = read_lock(self.repo_root)
        lock.remove_flow(flow_id)
        write_lock(self.repo_root, lock)
        maybe_auto_commit(
            repo_root=self.repo_root,
            flow_id=flow_id,
            flow_name=None,
            paths=[flow_relpath_for_id(flow_id), "flows.lock"],
            enabled=self.auto_commit,
        )

    def assert_lock_matches_tree(self, *, strict_extra_files: bool = False) -> list[str]:
        return assert_lock_matches_tree(self.repo_root, strict_extra_files=strict_extra_files)

    def db_canonical_sha(self, flow: Any) -> str:
        return sha256_raw(canonical_json_bytes(flow))

    def check_drift(self, flow: Any) -> DriftResult:
        flow_id = getattr(flow, "id", None) or (flow.get("id") if isinstance(flow, dict) else None)
        if flow_id is None:
            return DriftResult(drifted=False, db_sha256=None, disk_sha256=None, has_disk_file=False)
        db_sha = self.db_canonical_sha(flow)
        path = self.flow_path_for_id(flow_id)
        if not path.exists():
            # File missing while DB has row — treat as drift so UI can re-write or abort
            return DriftResult(drifted=True, db_sha256=db_sha, disk_sha256=None, has_disk_file=False)
        # Hash canonical export of disk JSON (not raw bytes) so machine-local keys omitted
        # from FLOW_EXPORT_KEYS (folder_id/workspace_id) do not false-positive after hydrate.
        disk_sha = sha256_raw(canonical_json_bytes(self.read_flow_file(flow_id)))
        return DriftResult(
            drifted=db_sha != disk_sha,
            db_sha256=db_sha,
            disk_sha256=disk_sha,
            has_disk_file=True,
        )

    def jail_external_path(self, candidate: Path | str) -> Path:
        try:
            return assert_under_jail(candidate, self.repo_root)
        except PathJailError:
            raise


_store_singleton: FlowGitStore | None = None
_store_root_key: str | None = None


def is_git_sot_enabled() -> bool:
    """True when git SoT mode is on and a flows-repo path can be resolved."""
    from langflow.services.flow_git.setup import resolve_git_flows_dir

    return resolve_git_flows_dir() is not None


def get_flow_git_store() -> FlowGitStore | None:
    """Return shared store when git SoT enabled; else None."""
    global _store_singleton, _store_root_key  # noqa: PLW0603

    from langflow.services.deps import get_settings_service
    from langflow.services.flow_git.setup import resolve_git_flows_dir

    root_path = resolve_git_flows_dir()
    if root_path is None:
        return None

    settings = get_settings_service().settings
    root = str(root_path)
    auto = bool(getattr(settings, "git_auto_commit", False))

    if _store_singleton is None or _store_root_key != root:
        _store_singleton = FlowGitStore(root, auto_commit=auto)
        _store_root_key = root
        logger.info("FlowGitStore ready root=%s auto_commit=%s", root, auto)
    else:
        _store_singleton.auto_commit = auto
    return _store_singleton


def refresh_flow_git_store() -> FlowGitStore | None:
    """Drop singleton so next get picks up post-clone path/settings."""
    global _store_singleton, _store_root_key  # noqa: PLW0603

    _store_singleton = None
    _store_root_key = None
    return get_flow_git_store()