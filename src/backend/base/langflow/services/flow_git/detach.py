"""Detach / wipe local flows git install and return app to setup wizard."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

from sqlmodel import select

from langflow.api.utils.flow_utils import cascade_delete_flow
from langflow.services.database.models.flow.model import Flow
from langflow.services.deps import session_scope
from langflow.services.flow_git.age_keys import clear_age_keys, keys_status
from langflow.services.flow_git.credentials import clear_pat
from langflow.services.flow_git.gitlab_client import parse_remote_url
from langflow.services.flow_git.repo import GitRepoService
from langflow.services.flow_git.setup import resolve_git_flows_dir
from langflow.services.flow_git.store import refresh_flow_git_store

logger = logging.getLogger("langflow.flow_git")


def repo_basename(project_path: str | None = None, *, url: str | None = None) -> str:
    """Short repo name used for detach confirm (e.g. ``LfxFlows``)."""
    path = (project_path or "").strip().rstrip("/")
    if not path and url:
        try:
            meta = parse_remote_url(url)
            path = (meta.get("project_path") or "").strip().rstrip("/")
        except Exception:  # noqa: BLE001
            path = ""
    if not path and url:
        cleaned = url.rstrip("/").removesuffix(".git")
        path = cleaned.rsplit("/", 1)[-1]
    if not path:
        return ""
    return path.split("/")[-1]


def expected_detach_confirm_name(repo_root: Path | None) -> str:
    if repo_root is None or not (Path(repo_root) / ".git").exists():
        return ""
    try:
        svc = GitRepoService(repo_root)
        url = svc.remote_url("origin") or ""
    except Exception:  # noqa: BLE001
        url = ""
    project_path = ""
    if url:
        try:
            project_path = parse_remote_url(url).get("project_path") or ""
        except Exception:  # noqa: BLE001
            project_path = ""
    name = repo_basename(project_path, url=url or None)
    if name:
        return name
    return Path(repo_root).name


async def detach_git_install(*, confirm: str) -> dict[str, Any]:
    """Wipe clone, DB flows, PAT, age keys; refresh store → setup incomplete."""
    root = resolve_git_flows_dir()
    expected = expected_detach_confirm_name(root)
    got = (confirm or "").strip()
    if not expected:
        msg = "Cannot resolve repository name for confirm. Is a git clone present?"
        raise ValueError(msg)
    if got != expected:
        msg = f"Confirm does not match repository name (expected {expected!r})."
        raise ValueError(msg)

    deleted_flows = 0
    async with session_scope() as session:
        flow_ids = list((await session.exec(select(Flow.id))).all())
        for flow_id in flow_ids:
            await cascade_delete_flow(
                session,
                flow_id,
                skip_git=True,
                skip_deployment_guard=True,
            )
            deleted_flows += 1

    pat_result = clear_pat()
    age_result = clear_age_keys()

    removed_dir: str | None = None
    if root is not None and Path(root).exists():
        shutil.rmtree(root)
        removed_dir = str(Path(root).resolve())
        logger.info("git detach: removed %s", removed_dir)

    refresh_flow_git_store()

    return {
        "ok": True,
        "deleted_flows": deleted_flows,
        "removed_dir": removed_dir,
        "pat": pat_result,
        "age_keys": age_result,
        "keys_status": keys_status(),
        "setup_complete": False,
    }
