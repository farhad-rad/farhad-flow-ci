"""Detect system ``git`` on PATH (GitPython requires it)."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache


INSTALL_HINT = (
    "Git is required for Langflow Desktop git SoT. "
    "Install Git for Windows (https://git-scm.com/download/win) "
    "or ensure ``git`` is on PATH, then restart the app."
)


@dataclass(frozen=True)
class GitBinaryStatus:
    available: bool
    path: str | None
    version: str | None
    message: str | None
    banner_code: str | None = None


@lru_cache(maxsize=1)
def _detect_git_binary_cached() -> GitBinaryStatus:
    path = shutil.which("git")
    if not path:
        return GitBinaryStatus(
            available=False,
            path=None,
            version=None,
            message=INSTALL_HINT,
            banner_code="GIT_NOT_INSTALLED",
        )
    try:
        proc = subprocess.run(  # noqa: S603
            [path, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        version = (proc.stdout or proc.stderr or "").strip() or None
        if proc.returncode != 0:
            return GitBinaryStatus(
                available=False,
                path=path,
                version=version,
                message=INSTALL_HINT,
                banner_code="GIT_NOT_INSTALLED",
            )
        return GitBinaryStatus(available=True, path=path, version=version, message=None)
    except (OSError, subprocess.TimeoutExpired):
        return GitBinaryStatus(
            available=False,
            path=path,
            version=None,
            message=INSTALL_HINT,
            banner_code="GIT_NOT_INSTALLED",
        )


def detect_git_binary(*, force_refresh: bool = False) -> GitBinaryStatus:
    if force_refresh:
        _detect_git_binary_cached.cache_clear()
    return _detect_git_binary_cached()



def require_git_binary() -> GitBinaryStatus:
    from langflow.services.flow_git.exceptions import GitNotInstalledError

    status = detect_git_binary()
    if not status.available:
        raise GitNotInstalledError(status.message or INSTALL_HINT)
    return status
