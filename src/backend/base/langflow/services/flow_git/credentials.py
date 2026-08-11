"""Store GitLab PAT in OS keyring with env fallback."""

from __future__ import annotations

import logging
import os
from typing import Final

logger = logging.getLogger("langflow.flow_git")

SERVICE_NAME: Final = "langflow-desktop-git"
USERNAME: Final = "gitlab-pat"
ENV_KEYS: Final = ("LANGFLOW_GIT_PAT", "LANGFLOW_GIT_TOKEN", "GITLAB_TOKEN", "GIT_TOKEN")


def _keyring_available() -> bool:
    try:
        import keyring  # noqa: F401

        return True
    except ImportError:
        return False


def store_pat(token: str) -> dict[str, str | bool]:
    """Persist PAT. Prefer keyring; else note env-only (does not write env)."""
    token = (token or "").strip()
    if not token:
        msg = "empty token"
        raise ValueError(msg)
    if _keyring_available():
        try:
            import keyring

            keyring.set_password(SERVICE_NAME, USERNAME, token)
            return {"stored": True, "backend": "keyring"}
        except Exception as exc:  # noqa: BLE001 — keyring backends vary wildly
            logger.warning("keyring store failed: %s", exc)
    return {
        "stored": False,
        "backend": "env",
        "hint": "Set LANGFLOW_GIT_PAT in environment; keyring unavailable or failed.",
    }


def clear_pat() -> dict[str, str | bool]:
    if _keyring_available():
        try:
            import keyring

            keyring.delete_password(SERVICE_NAME, USERNAME)
            return {"cleared": True, "backend": "keyring"}
        except Exception as exc:  # noqa: BLE001
            # keyring.errors.PasswordDeleteError when missing
            logger.debug("keyring clear: %s", exc)
    return {"cleared": True, "backend": "none"}


def load_pat() -> str | None:
    """keyring first, then env vars. Never logs token."""
    if _keyring_available():
        try:
            import keyring

            val = keyring.get_password(SERVICE_NAME, USERNAME)
            if val:
                return val
        except Exception as exc:  # noqa: BLE001
            logger.debug("keyring load failed: %s", exc)
    for key in ENV_KEYS:
        val = os.environ.get(key)
        if val and val.strip():
            return val.strip()
    return None


def pat_status() -> dict[str, bool | str]:
    token = load_pat()
    source = "none"
    if token:
        if _keyring_available():
            try:
                import keyring

                if keyring.get_password(SERVICE_NAME, USERNAME):
                    source = "keyring"
                else:
                    source = "env"
            except Exception:  # noqa: BLE001
                source = "env"
        else:
            source = "env"
    return {"configured": bool(token), "source": source, "keyring_available": _keyring_available()}
