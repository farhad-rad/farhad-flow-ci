"""Per-flow edit leases under ``.langflow/leases/<flow-id>.json``."""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from langflow.services.flow_git.atomic import atomic_write
from langflow.services.flow_git.exceptions import LeaseHeldError

logger = logging.getLogger("langflow.flow_git")

_lease_lock = threading.Lock()


@dataclass
class LeaseInfo:
    flow_id: str
    holder_id: str
    holder_name: str | None
    acquired_at: str
    expires_at: str
    renewed_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LeaseInfo:
        return cls(
            flow_id=str(data["flow_id"]),
            holder_id=str(data["holder_id"]),
            holder_name=data.get("holder_name"),
            acquired_at=str(data["acquired_at"]),
            expires_at=str(data["expires_at"]),
            renewed_at=data.get("renewed_at"),
        )

    def is_expired(self, *, now: datetime | None = None) -> bool:
        now = now or datetime.now(UTC)
        try:
            exp = datetime.fromisoformat(self.expires_at)
        except ValueError:
            return True
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=UTC)
        return now >= exp


def leases_dir(repo_root: Path) -> Path:
    return Path(repo_root) / ".langflow" / "leases"


def lease_path(repo_root: Path, flow_id: UUID | str) -> Path:
    return leases_dir(repo_root) / f"{UUID(str(flow_id))}.json"


def default_ttl_seconds() -> int:
    try:
        from langflow.services.deps import get_settings_service

        settings = get_settings_service().settings
        return int(getattr(settings, "git_lease_ttl_seconds", 300) or 300)
    except Exception:  # noqa: BLE001 — settings may be unavailable in scripts
        return 300


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _expires_iso(ttl: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=ttl)).isoformat()


def read_lease(repo_root: Path, flow_id: UUID | str) -> LeaseInfo | None:
    path = lease_path(repo_root, flow_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return LeaseInfo.from_dict(data)
    except (OSError, json.JSONDecodeError, KeyError, ValueError) as exc:
        logger.warning("bad lease file %s: %s", path, exc)
        return None


def clear_stale_lease(repo_root: Path, flow_id: UUID | str) -> bool:
    """Delete lease file if expired. Return True if cleared or already absent."""
    with _lease_lock:
        lease = read_lease(repo_root, flow_id)
        if lease is None:
            return True
        if lease.is_expired():
            path = lease_path(repo_root, flow_id)
            try:
                path.unlink(missing_ok=True)
            except OSError:
                return False
            logger.info("cleared stale lease flow_id=%s holder=%s", flow_id, lease.holder_id)
            return True
        return False


def acquire_lease(
    repo_root: Path,
    flow_id: UUID | str,
    *,
    holder_id: str,
    holder_name: str | None = None,
    ttl_seconds: int | None = None,
    steal: bool = False,
) -> LeaseInfo:
    ttl = ttl_seconds if ttl_seconds is not None else default_ttl_seconds()
    fid = str(UUID(str(flow_id)))
    with _lease_lock:
        existing = read_lease(repo_root, flow_id)
        if existing and not existing.is_expired():
            if existing.holder_id == str(holder_id):
                # renew in place
                existing.expires_at = _expires_iso(ttl)
                existing.renewed_at = _now_iso()
                _write_lease(repo_root, existing)
                return existing
            if not steal:
                raise LeaseHeldError(
                    f"Flow leased by {existing.holder_name or existing.holder_id} until {existing.expires_at}",
                )
        lease = LeaseInfo(
            flow_id=fid,
            holder_id=str(holder_id),
            holder_name=holder_name,
            acquired_at=_now_iso(),
            expires_at=_expires_iso(ttl),
            renewed_at=None,
        )
        _write_lease(repo_root, lease)
        return lease


def renew_lease(
    repo_root: Path,
    flow_id: UUID | str,
    *,
    holder_id: str,
    ttl_seconds: int | None = None,
) -> LeaseInfo:
    ttl = ttl_seconds if ttl_seconds is not None else default_ttl_seconds()
    with _lease_lock:
        existing = read_lease(repo_root, flow_id)
        if existing is None or existing.is_expired():
            return acquire_lease(
                repo_root,
                flow_id,
                holder_id=holder_id,
                ttl_seconds=ttl,
            )
        if existing.holder_id != str(holder_id):
            raise LeaseHeldError(
                f"Cannot renew: held by {existing.holder_name or existing.holder_id}",
            )
        existing.expires_at = _expires_iso(ttl)
        existing.renewed_at = _now_iso()
        _write_lease(repo_root, existing)
        return existing


def release_lease(
    repo_root: Path,
    flow_id: UUID | str,
    *,
    holder_id: str,
    force: bool = False,
) -> bool:
    with _lease_lock:
        existing = read_lease(repo_root, flow_id)
        if existing is None:
            return True
        if not force and existing.holder_id != str(holder_id) and not existing.is_expired():
            raise LeaseHeldError(
                f"Cannot release: held by {existing.holder_name or existing.holder_id}",
            )
        path = lease_path(repo_root, flow_id)
        path.unlink(missing_ok=True)
        return True


def lease_read_only_signal(
    repo_root: Path,
    flow_id: UUID | str,
    *,
    viewer_id: str,
) -> dict[str, Any]:
    """API helper: if another user holds lease → read_only True + banner payload."""
    clear_stale_lease(repo_root, flow_id)
    lease = read_lease(repo_root, flow_id)
    if lease is None or lease.is_expired():
        return {
            "read_only": False,
            "lease": None,
            "banner_code": None,
            "message": None,
        }
    if lease.holder_id == str(viewer_id):
        return {
            "read_only": False,
            "lease": lease.to_dict(),
            "banner_code": None,
            "message": None,
        }
    who = lease.holder_name or lease.holder_id
    return {
        "read_only": True,
        "lease": lease.to_dict(),
        "banner_code": "GIT_LEASE_HELD",
        "message": f"Read-only: {who} is editing this flow (lease until {lease.expires_at}).",
    }


def _write_lease(repo_root: Path, lease: LeaseInfo) -> None:
    path = lease_path(repo_root, lease.flow_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(lease.to_dict(), indent=2, ensure_ascii=False) + "\n"
    atomic_write(path, payload.encode("utf-8"))
