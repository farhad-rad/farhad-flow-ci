"""Debounced auto-commit on Save — never auto-push."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any
from uuid import UUID

logger = logging.getLogger("langflow.flow_git")

_lock = threading.Lock()
_timers: dict[str, threading.Timer] = {}
_pending: dict[str, dict[str, Any]] = {}


def _debounce_ms() -> float:
    try:
        from langflow.services.deps import get_settings_service

        settings = get_settings_service().settings
        ms = int(getattr(settings, "git_auto_commit_debounce_ms", 1500) or 1500)
        return max(1000, min(ms, 2000)) / 1000.0
    except Exception:  # noqa: BLE001
        return 1.5


def maybe_auto_commit(
    *,
    repo_root: Path,
    flow_id: UUID | str,
    flow_name: str | None,
    paths: list[str],
    enabled: bool,
) -> None:
    """Schedule debounced local commit. Never pushes."""
    name = (flow_name or "flow").strip() or "flow"
    message = f"flow: update {name} ({flow_id})"
    maybe_auto_commit_paths(
        repo_root=repo_root,
        message=message,
        paths=paths,
        enabled=enabled,
        extra={"flow_id": str(flow_id), "flow_name": name},
    )


def maybe_auto_commit_paths(
    *,
    repo_root: Path,
    message: str,
    paths: list[str],
    enabled: bool,
    extra: dict[str, Any] | None = None,
) -> None:
    """Schedule debounced commit for arbitrary repo-relative paths. Never pushes."""
    if not enabled:
        return

    root_key = str(Path(repo_root).resolve())
    msg = (message or "chore: auto-commit").strip() or "chore: auto-commit"

    with _lock:
        prev = _pending.get(root_key) or {"paths": set(), "message": msg}
        path_set: set[str] = set(prev.get("paths") or [])
        path_set.update(paths)
        payload: dict[str, Any] = {
            "paths": path_set,
            "message": msg,
            "repo_root": root_key,
        }
        if extra:
            payload.update(extra)
        _pending[root_key] = payload
        old = _timers.pop(root_key, None)
        if old is not None:
            old.cancel()
        delay = _debounce_ms()
        timer = threading.Timer(delay, _flush_auto_commit, args=(root_key,))
        timer.daemon = True
        _timers[root_key] = timer
        timer.start()
        logger.debug(
            "git_auto_commit scheduled in %.1fs repo=%s paths=%s",
            delay,
            root_key,
            paths,
        )


def _flush_auto_commit(root_key: str) -> None:
    with _lock:
        payload = _pending.pop(root_key, None)
        _timers.pop(root_key, None)
    if not payload:
        return

    repo_root = Path(payload["repo_root"])
    paths = sorted(payload["paths"])
    message = payload["message"]

    try:
        from langflow.services.flow_git.detect import detect_git_binary
        from langflow.services.flow_git.repo import GitRepoService

        if not detect_git_binary().available:
            logger.warning("git_auto_commit skipped: git binary missing")
            return
        if not (repo_root / ".git").exists():
            logger.warning("git_auto_commit skipped: %s is not a git repo", repo_root)
            return

        svc = GitRepoService.open(repo_root)
        # Never push from auto-commit
        result = svc.commit(
            paths,
            message,
            author_name="Langflow Desktop",
            author_email="desktop@localhost",
            skip_whitespace_only=True,
        )
        from langflow.services.flow_git.ops_log import append_ops_log

        append_ops_log(
            repo_root,
            op="auto_commit",
            ok=True,
            detail={
                "message": message,
                "skipped": result.get("skipped"),
                "hexsha": result.get("hexsha"),
                "flow_id": payload.get("flow_id"),
            },
        )
        logger.info(
            "git_auto_commit done skipped=%s hexsha=%s message=%s",
            result.get("skipped"),
            result.get("hexsha"),
            message,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("git_auto_commit failed repo=%s", repo_root)
        try:
            from langflow.services.flow_git.ops_log import append_ops_log

            append_ops_log(repo_root, op="auto_commit", ok=False, error=str(exc))
        except Exception:  # noqa: BLE001
            pass


def flush_pending_for_tests(repo_root: Path | str) -> None:
    """Cancel timer and flush immediately (manual scripts / debug)."""
    root_key = str(Path(repo_root).resolve())
    with _lock:
        old = _timers.pop(root_key, None)
        if old is not None:
            old.cancel()
    _flush_auto_commit(root_key)


def note_call_site(**_: Any) -> None:
    """Marker for grep/search of Phase 3 integration points."""
