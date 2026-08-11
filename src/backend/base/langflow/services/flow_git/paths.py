"""Path jail + Windows-safe path helpers for FlowGitStore."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from uuid import UUID


class PathJailError(ValueError):
    """Raised when a path escapes the git flows directory jail."""


def win_long_path(path: Path) -> Path:
    """On Windows, prefix long absolute paths with ``\\\\?\\`` when needed."""
    resolved = path if path.is_absolute() else path.resolve()
    as_str = str(resolved)
    if sys.platform != "win32":
        return resolved
    if as_str.startswith("\\\\?\\") or as_str.startswith("\\\\.\\"):
        return Path(as_str)
    # Extended-length path for >260 chars (or near the edge)
    if len(as_str) >= 240:
        if as_str.startswith("\\\\"):
            # UNC → \\?\UNC\server\share\...
            return Path("\\\\?\\UNC\\" + as_str.lstrip("\\"))
        return Path("\\\\?\\" + as_str)
    return resolved


def realpath_str(path: Path | str) -> str:
    return os.path.realpath(str(path))


def assert_under_jail(candidate: Path | str, jail_root: Path) -> Path:
    """Return canonical path if *candidate* is inside *jail_root*; else raise."""
    jail = realpath_str(jail_root)
    # Ensure jail exists so realpath is stable
    Path(jail).mkdir(parents=True, exist_ok=True)
    jail = realpath_str(jail)

    cand_raw = str(candidate).replace("\\", "/")
    if ".." in Path(cand_raw).parts or "\x00" in cand_raw:
        raise PathJailError("path traversal rejected")

    resolved = realpath_str(candidate)
    if resolved != jail and not resolved.startswith(jail + os.sep):
        raise PathJailError(f"path escapes jail: {resolved}")
    return win_long_path(Path(resolved))


def flows_subdir(repo_root: Path) -> Path:
    return repo_root / "flows"


def flow_relpath_for_id(flow_id: UUID | str) -> str:
    """POSIX-relative path stored in lock: ``flows/<uuid>.json``."""
    return f"flows/{UUID(str(flow_id))}.json"


def flow_path_for_id(repo_root: Path, flow_id: UUID | str) -> Path:
    rel = flow_relpath_for_id(flow_id)
    abs_path = (repo_root / Path(*rel.split("/"))).resolve()
    return assert_under_jail(abs_path, repo_root)
