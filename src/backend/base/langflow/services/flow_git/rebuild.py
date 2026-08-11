"""Startup: rebuild SQLite cache from git working tree when git SoT enabled."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

import orjson
from sqlmodel import select

from langflow.services.database.models.flow.model import Flow
from langflow.services.database.models.folder.utils import get_or_create_default_folder
from langflow.services.deps import get_settings_service, session_scope
from langflow.services.flow_git.setup import is_git_setup_complete
from langflow.services.flow_git.store import get_flow_git_store, is_git_sot_enabled

logger = logging.getLogger("langflow.flow_git")

HydrateMode = Literal["upsert", "full"]


async def hydrate_from_git(*, mode: HydrateMode = "upsert") -> dict[str, Any]:
    """Sync DB from git working tree.

    * ``upsert`` (pull/checkout/startup): write/update only; keep local-only rows.
    * ``full`` (git init / setup install): upsert then prune flows + variables not in git.
    """
    result: dict[str, Any] = {"mode": mode, "flows": None, "secrets": None}
    if not is_git_sot_enabled():
        return {"skipped": True, "reason": "git_disabled", "mode": mode}
    if not is_git_setup_complete():
        logger.info("Git SoT enabled but setup incomplete — skip hydrate until wizard finishes")
        return {"skipped": True, "reason": "setup_incomplete", "mode": mode}

    prune = mode == "full"
    flows_result = await rebuild_sqlite_from_git_tree(skip_secrets=True, prune=prune)
    result["flows"] = flows_result or {"ok": True, "prune": prune}

    secrets_user_id = None
    async with session_scope() as session:
        from langflow.services.database.models.user.model import User

        user = (await session.exec(select(User).where(User.is_superuser == True))).first()  # noqa: E712
        if user is not None:
            secrets_user_id = user.id

    if secrets_user_id is not None:
        from langflow.services.flow_git.age_keys import keys_unlocked
        from langflow.services.flow_git.secrets_sync import apply_secrets_from_git

        if keys_unlocked():
            secrets_result = await apply_secrets_from_git(user_id=secrets_user_id, prune=prune)
            result["secrets"] = secrets_result
            logger.info("flow_git hydrate secrets mode=%s: %s", mode, secrets_result)
        else:
            result["secrets"] = {"skipped": True, "reason": "keys_not_unlocked"}

    return result


async def rebuild_sqlite_from_git_tree(*, skip_secrets: bool = False, prune: bool = False) -> dict[str, Any] | None:
    """Upsert every ``flows/*.json`` into the superuser DB cache; set ``fs_path``.

    When *prune* is True, delete superuser flows whose ids are not present in the git tree.
    """
    if not is_git_sot_enabled():
        return None
    if not is_git_setup_complete():
        logger.info("Git SoT enabled but setup incomplete — skip rebuild until wizard finishes")
        return None

    store = get_flow_git_store()
    if store is None:
        return None
    settings = get_settings_service().settings
    if settings.load_flows_path:
        logger.warning(
            "LANGFLOW_GIT_ENABLED=true: ignoring LANGFLOW_LOAD_FLOWS_PATH=%s (git tree is SoT)",
            settings.load_flows_path,
        )

    problems = store.assert_lock_matches_tree(strict_extra_files=False)
    for problem in problems:
        logger.warning("flows.lock / tree: %s", problem)

    files = store.list_flow_files()
    logger.info("flow_git rebuild: %s flow file(s) under %s prune=%s", len(files), store.repo_root, prune)

    secrets_user_id = None
    deleted: list[str] = []
    upserted = 0
    async with session_scope() as session:
        from langflow.services.database.models.user.model import User

        stmt = select(User).where(User.is_superuser == True)  # noqa: E712
        user = (await session.exec(stmt)).first()
        if user is None:
            logger.error("flow_git rebuild aborted: no superuser")
            return {"ok": False, "error": "no_superuser"}

        folder = await get_or_create_default_folder(session, user.id)

        seen_ids: set[UUID] = set()
        for path in files:
            try:
                raw = path.read_bytes()
                payload = orjson.loads(raw)
            except Exception:  # noqa: BLE001
                logger.exception("flow_git rebuild: failed to read %s", path)
                continue

            stem = path.stem
            try:
                file_id = UUID(stem)
            except ValueError:
                logger.warning("flow_git rebuild: skip non-uuid filename %s", path.name)
                continue

            if "id" in payload:
                try:
                    payload_id = UUID(str(payload["id"]))
                    if payload_id != file_id:
                        logger.warning(
                            "flow_git rebuild: id mismatch file=%s json=%s — using filename",
                            file_id,
                            payload_id,
                        )
                except ValueError:
                    pass
            payload["id"] = str(file_id)
            payload["user_id"] = str(user.id)
            payload["fs_path"] = store.fs_path_for_id(file_id)
            if not payload.get("folder_id"):
                payload["folder_id"] = str(folder.id)

            existing = (await session.exec(select(Flow).where(Flow.id == file_id))).first()
            if existing:
                for key in (
                    "name",
                    "description",
                    "icon",
                    "icon_bg_color",
                    "gradient",
                    "data",
                    "is_component",
                    "endpoint_name",
                    "tags",
                    "locked",
                    "mcp_enabled",
                    "action_name",
                    "action_description",
                    "access_type",
                    "flow_type",
                    "a2a_enabled",
                    "a2a_card_overrides",
                    "webhook",
                    "fs_path",
                ):
                    if key in payload:
                        setattr(existing, key, payload[key])
                existing.user_id = user.id
                if existing.folder_id is None:
                    existing.folder_id = folder.id
                session.add(existing)
            else:
                # Name uniqueness: if name collides with different id, suffix
                name = payload.get("name") or f"Flow {file_id}"
                conflict = (
                    await session.exec(
                        select(Flow).where(Flow.user_id == user.id, Flow.name == name, Flow.id != file_id)
                    )
                ).first()
                if conflict:
                    name = f"{name} ({str(file_id)[:8]})"
                    payload["name"] = name
                flow = Flow.model_validate(payload)
                flow.id = file_id
                flow.user_id = user.id
                # Always attach to local default folder — remote folder_id UUIDs are not in this DB.
                # folder_id is omitted from canonical export / drift hash (see FLOW_EXPORT_KEYS).
                flow.folder_id = folder.id
                flow.fs_path = store.fs_path_for_id(file_id)
                session.add(flow)

            seen_ids.add(file_id)
            upserted += 1
            logger.info("flow_git rebuild upserted id=%s from %s", file_id, path.name)

        if prune:
            from langflow.api.utils.flow_utils import cascade_delete_flow

            all_ids = list((await session.exec(select(Flow.id).where(Flow.user_id == user.id))).all())
            for flow_id in all_ids:
                if flow_id in seen_ids:
                    continue
                await cascade_delete_flow(
                    session,
                    flow_id,
                    skip_git=True,
                    skip_deployment_guard=True,
                )
                deleted.append(str(flow_id))
                logger.info("flow_git full hydrate pruned flow id=%s", flow_id)

        secrets_user_id = user.id

    if not skip_secrets:
        try:
            from langflow.services.flow_git.age_keys import keys_unlocked
            from langflow.services.flow_git.secrets_sync import apply_secrets_from_git

            if keys_unlocked() and secrets_user_id is not None:
                result = await apply_secrets_from_git(user_id=secrets_user_id, prune=prune)
                logger.info("flow_git secrets apply: %s", result)
        except Exception:  # noqa: BLE001
            logger.exception("flow_git secrets apply failed")

    return {"ok": True, "upserted": upserted, "deleted": deleted, "prune": prune}


async def sync_sqlite_after_discard(paths: list[str]) -> dict[str, Any]:
    """After git discard: upsert restored flow files; delete DB rows when file gone."""
    from langflow.api.utils.flow_utils import cascade_delete_flow

    result: dict[str, Any] = {"upserted": [], "deleted": [], "errors": []}
    if not paths:
        result["errors"].append("no paths")
        return result

    store = get_flow_git_store()
    if store is None:
        # Fall back: enable check shouldn't block if resolve failed mid-request.
        logger.warning("flow_git discard sync: FlowGitStore unavailable")
        result["errors"].append("FlowGitStore unavailable")
        return result

    flow_paths: list[Path] = []
    for rel in paths:
        rel_n = rel.replace("\\", "/").lstrip("./")
        if not rel_n.startswith("flows/") or not rel_n.endswith(".json"):
            continue
        stem = Path(rel_n).stem
        try:
            UUID(stem)
        except ValueError:
            continue
        flow_paths.append(store.repo_root / rel_n)

    if not flow_paths:
        logger.warning("flow_git discard sync: no flow paths in %s", paths)
        result["errors"].append(f"no flow paths in {paths!r}")
        return result

    async with session_scope() as session:
        from langflow.services.database.models.user.model import User

        stmt = select(User).where(User.is_superuser == True)  # noqa: E712
        user = (await session.exec(stmt)).first()
        if user is None:
            result["errors"].append("no superuser")
            return result
        folder = await get_or_create_default_folder(session, user.id)

        for path in flow_paths:
            stem = path.stem
            try:
                file_id = UUID(stem)
            except ValueError:
                continue

            if not path.is_file():
                try:
                    existing = (
                        await session.exec(select(Flow).where(Flow.id == file_id))
                    ).first()
                    if existing is not None:
                        # Disk already discarded — DB-only cascade.
                        await cascade_delete_flow(
                            session,
                            file_id,
                            skip_git=True,
                            skip_deployment_guard=True,
                        )
                        result["deleted"].append(str(file_id))
                        logger.info("flow_git discard sync deleted DB flow id=%s", file_id)
                    else:
                        logger.info(
                            "flow_git discard sync: no DB row for missing file id=%s",
                            file_id,
                        )
                except Exception as exc:  # noqa: BLE001
                    logger.exception("flow_git discard sync delete failed id=%s", file_id)
                    result["errors"].append(f"{file_id}: delete {exc}")
                continue

            try:
                raw = path.read_bytes()
                payload = orjson.loads(raw)
            except Exception as exc:  # noqa: BLE001
                logger.exception("flow_git discard sync read failed %s", path)
                result["errors"].append(f"{file_id}: read {exc}")
                continue

            payload["id"] = str(file_id)
            payload["user_id"] = str(user.id)
            payload["fs_path"] = store.fs_path_for_id(file_id)
            if not payload.get("folder_id"):
                payload["folder_id"] = str(folder.id)

            existing = (await session.exec(select(Flow).where(Flow.id == file_id))).first()
            if existing:
                for key in (
                    "name",
                    "description",
                    "icon",
                    "icon_bg_color",
                    "gradient",
                    "data",
                    "is_component",
                    "endpoint_name",
                    "tags",
                    "locked",
                    "mcp_enabled",
                    "action_name",
                    "action_description",
                    "access_type",
                    "flow_type",
                    "a2a_enabled",
                    "a2a_card_overrides",
                    "webhook",
                    "fs_path",
                ):
                    if key in payload:
                        setattr(existing, key, payload[key])
                existing.user_id = user.id
                if existing.folder_id is None:
                    existing.folder_id = folder.id
                session.add(existing)
            else:
                name = payload.get("name") or f"Flow {file_id}"
                conflict = (
                    await session.exec(
                        select(Flow).where(Flow.user_id == user.id, Flow.name == name, Flow.id != file_id)
                    )
                ).first()
                if conflict:
                    name = f"{name} ({str(file_id)[:8]})"
                    payload["name"] = name
                flow = Flow.model_validate(payload)
                flow.id = file_id
                flow.user_id = user.id
                flow.folder_id = folder.id
                flow.fs_path = store.fs_path_for_id(file_id)
                session.add(flow)
            result["upserted"].append(str(file_id))
            logger.info("flow_git discard sync upserted id=%s", file_id)

    logger.info("flow_git discard sync done %s", result)
    return result


async def load_flows_from_git_or_directory() -> None:
    """Startup entry: git hydrate XOR upstream LOAD_FLOWS_PATH loader."""
    if is_git_sot_enabled():
        await hydrate_from_git()
        return

    from langflow.initial_setup.setup import load_flows_from_directory

    await load_flows_from_directory()
