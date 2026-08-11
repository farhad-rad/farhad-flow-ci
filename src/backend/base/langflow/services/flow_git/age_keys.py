"""OS keyring storage for age keys unlocked from ``.langflow/keys.age``."""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Any

from langflow.services.flow_git.credentials import SERVICE_NAME

logger = logging.getLogger("langflow.flow_git")

USER_PASSPHRASE = "keys-age-passphrase"
USER_PRODUCTION_PUB = "production.pub"
USER_FLOW_CI_PUB = "flow-ci.pub"
USER_FLOW_CI_KEY = "flow-ci.key"
USER_KEYS_AGE_BLOB = "keys-age-blob"
USER_GITLAB_HOST = "gitlab-host"


def _keyring_available() -> bool:
    try:
        import keyring  # noqa: F401

        return True
    except ImportError:
        return False


def _get_password(username: str) -> str | None:
    if not _keyring_available():
        return None
    try:
        import keyring

        val = keyring.get_password(SERVICE_NAME, username)
        return val if val else None
    except Exception as exc:  # noqa: BLE001
        logger.debug("keyring get %s failed: %s", username, exc)
        return None


def _set_password(username: str, value: str) -> bool:
    if not _keyring_available():
        return False
    try:
        import keyring

        keyring.set_password(SERVICE_NAME, username, value)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("keyring set %s failed: %s", username, exc)
        return False


def _delete_password(username: str) -> None:
    if not _keyring_available():
        return
    try:
        import keyring

        keyring.delete_password(SERVICE_NAME, username)
    except Exception as exc:  # noqa: BLE001
        logger.debug("keyring delete %s: %s", username, exc)


@dataclass
class UnlockedKeyMaterial:
    production_pub: str
    flow_ci_pub: str
    flow_ci_key: str
    passphrase: str
    keys_age_blob: bytes


def store_unlocked_keys(material: UnlockedKeyMaterial) -> dict[str, Any]:
    """Persist passphrase + three age keys (+ optional keys.age blob for fresh scaffold)."""
    if not _keyring_available():
        msg = "OS keyring unavailable — cannot store age keys"
        raise RuntimeError(msg)
    ok = all(
        [
            _set_password(USER_PASSPHRASE, material.passphrase),
            _set_password(USER_PRODUCTION_PUB, material.production_pub.strip()),
            _set_password(USER_FLOW_CI_PUB, material.flow_ci_pub.strip()),
            _set_password(USER_FLOW_CI_KEY, material.flow_ci_key.strip()),
            _set_password(USER_KEYS_AGE_BLOB, base64.b64encode(material.keys_age_blob).decode("ascii")),
        ]
    )
    if not ok:
        msg = "Failed to store one or more age key entries in keyring"
        raise RuntimeError(msg)
    return {"stored": True, "backend": "keyring"}


def load_encrypt_recipients() -> list[str] | None:
    prod = _get_password(USER_PRODUCTION_PUB)
    ci_pub = _get_password(USER_FLOW_CI_PUB)
    if prod and ci_pub:
        return [prod.strip(), ci_pub.strip()]
    return None


def load_flow_ci_identity() -> str | None:
    val = _get_password(USER_FLOW_CI_KEY)
    return val.strip() if val else None


def load_keys_age_passphrase() -> str | None:
    val = _get_password(USER_PASSPHRASE)
    return val if val else None


def load_keys_age_blob() -> bytes | None:
    val = _get_password(USER_KEYS_AGE_BLOB)
    if not val:
        return None
    try:
        return base64.b64decode(val.encode("ascii"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("keys-age-blob decode failed: %s", exc)
        return None


def gitlab_api_base(host: str) -> str:
    return f"{normalize_gitlab_host(host).rstrip('/')}/api/v4"


def store_gitlab_host(host: str) -> dict[str, Any]:
    normalized = normalize_gitlab_host(host)
    api_base = gitlab_api_base(normalized)
    if not _set_password(USER_GITLAB_HOST, normalized):
        return {"stored": False, "host": normalized, "api_base": api_base, "backend": "none"}
    return {"stored": True, "host": normalized, "api_base": api_base, "backend": "keyring"}


def load_gitlab_host() -> str | None:
    return _get_password(USER_GITLAB_HOST)


def normalize_gitlab_host(host: str) -> str:
    raw = (host or "").strip().rstrip("/")
    if not raw:
        msg = "GitLab host required"
        raise ValueError(msg)
    if raw.endswith("/api/v4"):
        raw = raw[: -len("/api/v4")].rstrip("/")
    if "://" not in raw:
        raw = f"https://{raw}"
    from urllib.parse import urlparse, urlunparse

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        msg = f"Invalid GitLab host: {host}"
        raise ValueError(msg)
    netloc = parsed.hostname
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, "", "", "", "")).rstrip("/")


def keys_unlocked() -> bool:
    return load_encrypt_recipients() is not None and load_flow_ci_identity() is not None


def keys_status() -> dict[str, Any]:
    recipients = load_encrypt_recipients()
    identity = load_flow_ci_identity()
    passphrase = load_keys_age_passphrase()
    blob = load_keys_age_blob()
    host = load_gitlab_host()
    return {
        "unlocked": bool(recipients and identity),
        "has_passphrase": bool(passphrase),
        "has_keys_age_blob": blob is not None,
        "recipients_configured": bool(recipients),
        "identity_configured": bool(identity),
        "keyring_available": _keyring_available(),
        "gitlab_host": host,
        "entries": {
            "passphrase": bool(passphrase),
            "production.pub": bool(recipients and recipients[0]),
            "flow-ci.pub": bool(recipients and len(recipients) > 1),
            "flow-ci.key": bool(identity),
            "keys-age-blob": blob is not None,
        },
    }


def clear_age_keys() -> dict[str, Any]:
    for username in (
        USER_PASSPHRASE,
        USER_PRODUCTION_PUB,
        USER_FLOW_CI_PUB,
        USER_FLOW_CI_KEY,
        USER_KEYS_AGE_BLOB,
        USER_GITLAB_HOST,
    ):
        _delete_password(username)
    return {"cleared": True, "configured": False}
