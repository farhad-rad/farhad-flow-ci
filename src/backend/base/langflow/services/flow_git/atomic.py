"""Atomic file write: write staging file then rename into place."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from langflow.services.flow_git.paths import win_long_path

logger = logging.getLogger("langflow.flow_git")


def atomic_write(path: Path, data: bytes) -> None:
    """Write *data* to *path* via ``*.staging`` + ``os.replace``.

    Same-volume rename is atomic on POSIX and Windows. Logs every successful write.
    """
    target = win_long_path(path if path.is_absolute() else path.resolve())
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = win_long_path(target.parent / f".{target.name}.staging")

    try:
        with open(staging, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(staging, target)
    except Exception:
        # Best-effort cleanup of staging artifact
        try:
            if staging.exists():
                staging.unlink()
        except OSError:
            pass
        raise

    logger.info("flow_git disk write path=%s bytes=%s", target, len(data))
