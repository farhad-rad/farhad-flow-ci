"""Conflict file copies under ``.langflow/conflicts/`` — no silent JSON merge."""

from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from langflow.services.flow_git.paths import flow_path_for_id, flow_relpath_for_id

logger = logging.getLogger("langflow.flow_git")


@dataclass
class ConflictRecord:
    flow_id: str
    rel_path: str
    created_at: str
    ours: str
    theirs: str
    base: str | None
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "flow_id": self.flow_id,
            "rel_path": self.rel_path,
            "created_at": self.created_at,
            "ours": self.ours,
            "theirs": self.theirs,
            "base": self.base,
            "reason": self.reason,
        }


def conflicts_dir(repo_root: Path) -> Path:
    return Path(repo_root) / ".langflow" / "conflicts"


def conflict_flow_dir(repo_root: Path, flow_id: UUID | str) -> Path:
    return conflicts_dir(repo_root) / str(UUID(str(flow_id)))


def list_conflicts(repo_root: Path) -> list[dict[str, Any]]:
    root = conflicts_dir(repo_root)
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for meta in sorted(root.glob("*/meta.json")):
        try:
            out.append(json.loads(meta.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def has_unresolved_conflicts(repo_root: Path) -> bool:
    return bool(list_conflicts(repo_root))


def store_conflict(
    repo_root: Path,
    flow_id: UUID | str,
    *,
    ours_bytes: bytes | None,
    theirs_bytes: bytes | None,
    base_bytes: bytes | None = None,
    reason: str = "merge_conflict",
) -> ConflictRecord:
    """Copy ours/theirs/base under conflicts dir. Never auto-merge JSON."""
    fid = str(UUID(str(flow_id)))
    dest = conflict_flow_dir(repo_root, fid)
    dest.mkdir(parents=True, exist_ok=True)
    ours_p = dest / "ours.json"
    theirs_p = dest / "theirs.json"
    base_p = dest / "base.json"

    if ours_bytes is not None:
        ours_p.write_bytes(ours_bytes)
    elif flow_path_for_id(repo_root, fid).exists():
        shutil.copy2(flow_path_for_id(repo_root, fid), ours_p)

    if theirs_bytes is not None:
        theirs_p.write_bytes(theirs_bytes)
    if base_bytes is not None:
        base_p.write_bytes(base_bytes)

    rec = ConflictRecord(
        flow_id=fid,
        rel_path=flow_relpath_for_id(fid),
        created_at=datetime.now(UTC).isoformat(),
        ours=str(ours_p.relative_to(repo_root)) if ours_p.exists() else "",
        theirs=str(theirs_p.relative_to(repo_root)) if theirs_p.exists() else "",
        base=str(base_p.relative_to(repo_root)) if base_p.exists() else None,
        reason=reason,
    )
    (dest / "meta.json").write_text(
        json.dumps(rec.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    logger.info("stored conflict flow_id=%s reason=%s", fid, reason)
    return rec


def clear_conflict(repo_root: Path, flow_id: UUID | str) -> None:
    dest = conflict_flow_dir(repo_root, flow_id)
    if dest.is_dir():
        shutil.rmtree(dest)


def flow_ids_from_unmerged_paths(paths: list[str]) -> list[str]:
    """Extract flow UUIDs from paths like ``flows/<uuid>.json``."""
    ids: list[str] = []
    for p in paths:
        norm = p.replace("\\", "/")
        if not norm.startswith("flows/") or not norm.endswith(".json"):
            continue
        stem = Path(norm).stem
        try:
            ids.append(str(UUID(stem)))
        except ValueError:
            continue
    return ids
