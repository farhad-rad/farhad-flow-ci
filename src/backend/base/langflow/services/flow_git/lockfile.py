"""flows.lock schema v1 read/write."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

from langflow.services.flow_git.atomic import atomic_write
from langflow.services.flow_git.canonical import sha256_raw
from langflow.services.flow_git.paths import assert_under_jail, win_long_path

logger = logging.getLogger("langflow.flow_git")

LOCK_VERSION = 1


@dataclass
class LockEntry:
    path: str
    sha256: str

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path, "sha256": self.sha256}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LockEntry:
        return cls(path=str(data["path"]), sha256=str(data["sha256"]))


@dataclass
class FlowsLock:
    version: int = LOCK_VERSION
    flows: dict[str, LockEntry] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "flows": {fid: entry.to_dict() for fid, entry in sorted(self.flows.items())},
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FlowsLock:
        version = int(data.get("version", LOCK_VERSION))
        flows_raw = data.get("flows") or {}
        flows = {str(fid): LockEntry.from_dict(entry) for fid, entry in flows_raw.items()}
        return cls(version=version, flows=flows)

    def set_flow(self, flow_id: UUID | str, *, rel_path: str, sha256: str) -> None:
        self.flows[str(flow_id)] = LockEntry(path=rel_path, sha256=sha256)

    def remove_flow(self, flow_id: UUID | str) -> None:
        self.flows.pop(str(flow_id), None)


def lock_path(repo_root: Path) -> Path:
    return repo_root / "flows.lock"


def read_lock(repo_root: Path) -> FlowsLock:
    path = lock_path(repo_root)
    if not path.exists():
        return FlowsLock()
    raw = win_long_path(path).read_bytes()
    data = json.loads(raw.decode("utf-8"))
    lock = FlowsLock.from_dict(data)
    if lock.version != LOCK_VERSION:
        logger.warning("flows.lock version=%s expected=%s", lock.version, LOCK_VERSION)
    return lock


def write_lock(repo_root: Path, lock: FlowsLock) -> None:
    lock.version = LOCK_VERSION
    text = json.dumps(lock.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    atomic_write(lock_path(repo_root), text.encode("utf-8"))


def lock_from_git_blob(raw: str | bytes | None) -> FlowsLock:
    if raw is None or raw == "":
        return FlowsLock()
    if isinstance(raw, bytes):
        text = raw.decode("utf-8")
    else:
        text = raw
    data = json.loads(text)
    return FlowsLock.from_dict(data)


def apply_selected_paths_to_lock(
    lock: FlowsLock,
    repo_root: Path,
    paths: list[str],
) -> FlowsLock:
    """Update *lock* only for selected flow paths (worktree hash or remove if deleted)."""
    root = Path(repo_root)
    for rel in paths:
        rel_n = rel.replace("\\", "/").lstrip("./")
        if rel_n == "flows.lock" or not rel_n.startswith("flows/"):
            continue
        if not rel_n.endswith(".json"):
            continue
        stem = Path(rel_n).stem
        try:
            UUID(stem)
        except ValueError:
            continue
        abs_path = root / rel_n
        if abs_path.is_file():
            lock.set_flow(stem, rel_path=rel_n, sha256=sha256_raw(abs_path.read_bytes()))
        else:
            lock.remove_flow(stem)
    return lock


def restore_selected_paths_in_lock(
    lock: FlowsLock,
    head_lock: FlowsLock,
    paths: list[str],
) -> FlowsLock:
    """Put selected flow ids back to HEAD lock state (discard / rollback)."""
    for rel in paths:
        rel_n = rel.replace("\\", "/").lstrip("./")
        if rel_n == "flows.lock" or not rel_n.startswith("flows/"):
            continue
        if not rel_n.endswith(".json"):
            continue
        stem = Path(rel_n).stem
        try:
            UUID(stem)
        except ValueError:
            continue
        entry = head_lock.flows.get(stem)
        if entry is None:
            lock.remove_flow(stem)
        else:
            lock.set_flow(stem, rel_path=entry.path, sha256=entry.sha256)
    return lock


def assert_lock_matches_tree(repo_root: Path, *, strict_extra_files: bool = False) -> list[str]:
    """Verify each lock entry SHA matches on-disk file. Return list of problems (empty = OK)."""
    problems: list[str] = []
    lock = read_lock(repo_root)
    for flow_id, entry in lock.flows.items():
        try:
            abs_path = assert_under_jail(repo_root / Path(*entry.path.replace("\\", "/").split("/")), repo_root)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{flow_id}: bad path {entry.path!r}: {exc}")
            continue
        if not abs_path.exists():
            problems.append(f"{flow_id}: missing file {entry.path}")
            continue
        digest = sha256_raw(abs_path.read_bytes())
        if digest != entry.sha256:
            problems.append(f"{flow_id}: sha mismatch lock={entry.sha256} disk={digest}")

    if strict_extra_files:
        flows_dir = repo_root / "flows"
        if flows_dir.is_dir():
            locked_paths = {e.path.replace("\\", "/") for e in lock.flows.values()}
            for fp in flows_dir.glob("*.json"):
                rel = f"flows/{fp.name}"
                if rel not in locked_paths:
                    problems.append(f"extra file not in lock: {rel}")

    return problems
