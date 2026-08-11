"""Sync DB Variables ↔ git encrypted secrets tree."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Iterator
from uuid import UUID

from sqlmodel import select

from langflow.services.auth import utils as auth_utils
from langflow.services.database.models.variable.model import Variable
from langflow.services.deps import session_scope
from langflow.services.flow_git.age_keys import keys_unlocked, load_flow_ci_identity
from langflow.services.flow_git.secrets_store import SecretsGitStore, get_secrets_git_store
from langflow.services.variable.constants import CREDENTIAL_TYPE

logger = logging.getLogger("langflow.flow_git")

# Built-in / agentic placeholders — never encrypt into git (like gitignore).
GIT_IGNORED_VARIABLE_NAMES: frozenset[str] = frozenset(
    {
        "FIELD_NAME",
        "FLOW_ID",
        "COMPONENT_ID",
        "ASTRA_TOKEN",
    }
)

_skip_git_secret_sync: ContextVar[bool] = ContextVar("skip_git_secret_sync", default=False)


def is_git_ignored_variable(name: str | None) -> bool:
    return bool(name) and name in GIT_IGNORED_VARIABLE_NAMES


@contextmanager
def skip_git_secret_sync() -> Iterator[None]:
    token = _skip_git_secret_sync.set(True)
    try:
        yield
    finally:
        _skip_git_secret_sync.reset(token)


def git_secret_sync_skipped() -> bool:
    return bool(_skip_git_secret_sync.get())


def _plaintext_from_row(variable: Variable) -> str | None:
    if not variable.value:
        return ""
    if variable.type == CREDENTIAL_TYPE:
        try:
            return auth_utils.decrypt_api_key(variable.value) or ""
        except Exception as exc:  # noqa: BLE001
            logger.warning("secrets sync: decrypt failed for %s: %s", variable.name, exc)
            return None
    return str(variable.value)


def _fmt_updated(variable: Variable) -> str | None:
    ts = variable.updated_at or variable.created_at
    if isinstance(ts, datetime):
        return ts.isoformat()
    return None


def sync_variable_to_git(
    variable: Variable,
    *,
    plaintext: str | None = None,
) -> dict[str, Any]:
    """Encrypt one Variable into ``secrets/vars/<id>.json``. No-op when unset."""
    if git_secret_sync_skipped():
        return {"skipped": True, "reason": "apply_in_progress"}
    if is_git_ignored_variable(variable.name):
        if variable.id is not None:
            store = get_secrets_git_store()
            if store is not None and keys_unlocked():
                try:
                    from langflow.services.flow_git.secrets_store import secret_path_for_id

                    if secret_path_for_id(store.repo_root, variable.id).is_file():
                        store.delete_variable(variable.id, name=variable.name)
                except Exception:  # noqa: BLE001
                    logger.debug("secrets sync: ignore cleanup failed for %s", variable.name, exc_info=True)
        return {"skipped": True, "reason": "git_ignored"}
    if not keys_unlocked():
        return {"skipped": True, "reason": "keys_not_unlocked"}
    store = get_secrets_git_store()
    if store is None:
        return {"skipped": True, "reason": "git_not_ready"}
    if variable.id is None:
        return {"skipped": True, "reason": "no_id"}

    value = plaintext if plaintext is not None else _plaintext_from_row(variable)
    if value is None:
        return {"skipped": True, "reason": "decrypt_failed"}

    digest = store.write_variable(
        variable_id=variable.id,
        name=variable.name or str(variable.id),
        type_=variable.type,
        default_fields=list(variable.default_fields or []),
        plaintext_value=value,
        updated_at=_fmt_updated(variable),
    )
    return {"ok": True, "sha256": digest, "id": str(variable.id)}


def delete_variable_from_git(variable_id: UUID | str, *, name: str | None = None) -> dict[str, Any]:
    if git_secret_sync_skipped():
        return {"skipped": True, "reason": "apply_in_progress"}
    if not keys_unlocked():
        return {"skipped": True, "reason": "keys_not_unlocked"}
    store = get_secrets_git_store()
    if store is None:
        return {"skipped": True, "reason": "git_not_ready"}
    store.delete_variable(variable_id, name=name)
    return {"ok": True, "id": str(variable_id)}


def safe_sync_variable_to_git(variable: Variable, *, plaintext: str | None = None) -> None:
    try:
        sync_variable_to_git(variable, plaintext=plaintext)
    except Exception:  # noqa: BLE001
        logger.exception("secrets sync failed for variable %s", getattr(variable, "name", None))


def safe_delete_variable_from_git(variable_id: UUID | str, *, name: str | None = None) -> None:
    try:
        delete_variable_from_git(variable_id, name=name)
    except Exception:  # noqa: BLE001
        logger.exception("secrets sync delete failed for %s", variable_id)


async def sync_all_variables_to_git(*, user_id: UUID | str | None = None) -> dict[str, Any]:
    """Re-encrypt every Variable (optionally for one user) into the repo."""
    if not keys_unlocked():
        return {"ok": False, "reason": "keys_not_unlocked", "written": 0}
    if get_secrets_git_store() is None:
        return {"ok": False, "reason": "git_not_ready", "written": 0}

    written = 0
    skipped = 0
    async with session_scope() as session:
        stmt = select(Variable)
        if user_id is not None:
            stmt = stmt.where(Variable.user_id == user_id)
        rows = list((await session.exec(stmt)).all())
        for row in rows:
            result = sync_variable_to_git(row)
            if result.get("ok"):
                written += 1
            else:
                skipped += 1
    return {"ok": True, "written": written, "skipped": skipped}


async def apply_secrets_from_git(*, user_id: UUID, prune: bool = False) -> dict[str, Any]:
    """Decrypt ``secrets/vars/*.json`` with flow-ci.key → upsert Variables.

    When *prune* is True, delete user variables that are not present in the git
    secrets tree (builtins in ``GIT_IGNORED_VARIABLE_NAMES`` are kept).
    """
    if not load_flow_ci_identity():
        return {"skipped": True, "reason": "keys_not_unlocked"}
    store = get_secrets_git_store()
    if store is None:
        from langflow.services.flow_git.setup import resolve_git_flows_dir

        root = resolve_git_flows_dir()
        if root is None:
            return {"skipped": True, "reason": "no_repo"}
        store = SecretsGitStore(root, auto_commit=False)

    applied = 0
    deleted = 0
    errors: list[str] = []
    seen_names: set[str] = set()
    from langflow.services.deps import get_settings_service
    from langflow.services.variable.service import DatabaseVariableService

    settings = get_settings_service()
    svc = DatabaseVariableService(settings)

    with skip_git_secret_sync():
        async with session_scope() as session:
            for path in store.list_secret_files():
                try:
                    payload = store.decrypt_file(path)
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{path.name}: {exc}")
                    continue
                name = str(payload.get("name") or "").strip()
                value = payload.get("value")
                if not name or value is None:
                    errors.append(f"{path.name}: missing name/value")
                    continue
                if is_git_ignored_variable(name):
                    continue
                type_ = str(payload.get("type") or CREDENTIAL_TYPE)
                fields = payload.get("default_fields") or []
                if not isinstance(fields, list):
                    fields = []
                try:
                    existing = (
                        await session.exec(
                            select(Variable).where(Variable.user_id == user_id, Variable.name == name)
                        )
                    ).first()
                    if existing:
                        await svc.update_variable(user_id, name, str(value), session=session)
                        if existing.type != type_ or list(existing.default_fields or []) != list(fields):
                            from langflow.services.database.models.variable.model import VariableUpdate

                            await svc.update_variable_fields(
                                user_id,
                                existing.id,
                                VariableUpdate(id=existing.id, type=type_, default_fields=list(fields)),
                                session=session,
                            )
                    else:
                        await svc.create_variable(
                            user_id=user_id,
                            name=name,
                            value=str(value),
                            default_fields=list(fields),
                            type_=type_,
                            session=session,
                        )
                    seen_names.add(name)
                    applied += 1
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{name}: {exc}")

            if prune:
                rows = list(
                    (await session.exec(select(Variable).where(Variable.user_id == user_id))).all()
                )
                for row in rows:
                    name = (row.name or "").strip()
                    if not name or is_git_ignored_variable(name):
                        continue
                    if name in seen_names:
                        continue
                    try:
                        await svc.delete_variable(user_id, name, session=session)
                        deleted += 1
                        logger.info("flow_git full hydrate pruned variable name=%s", name)
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"prune {name}: {exc}")

    return {"ok": True, "applied": applied, "deleted": deleted, "prune": prune, "errors": errors}
