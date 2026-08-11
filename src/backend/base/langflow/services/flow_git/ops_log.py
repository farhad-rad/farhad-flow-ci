"""Append-only local ops log: ``.langflow/git-ops.log``."""

from __future__ import annotations

import json
import logging
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("langflow.flow_git")

_lock = threading.Lock()


def ops_log_path(repo_root: Path) -> Path:
    return Path(repo_root) / ".langflow" / "git-ops.log"


def append_ops_log(
    repo_root: Path,
    *,
    op: str,
    ok: bool,
    detail: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Best-effort append JSON line. Never raises to callers."""
    try:
        path = ops_log_path(repo_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "ts": datetime.now(UTC).isoformat(),
            "op": op,
            "ok": ok,
            "detail": detail or {},
            "error": error,
        }
        line = json.dumps(row, ensure_ascii=False, default=str) + "\n"
        with _lock, path.open("a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError as exc:
        logger.warning("git-ops.log write failed: %s", exc)
