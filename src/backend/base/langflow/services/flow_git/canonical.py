"""Canonical JSON bytes + SHA-256 for flow files (Desktop ↔ CI).

See docs/git-sot/CANONICAL_HASH.md.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID


# Fields persisted in flows/<uuid>.json (stable identity + UI-relevant payload).
# Intentionally omit user_id / relationships — tree is shared; ownership assigned on rebuild.
# Also omit folder_id / workspace_id — those UUIDs are machine-local DB rows; exporting them
# causes false Git SoT drift after hydrate remaps flows into the local default folder.
FLOW_EXPORT_KEYS: tuple[str, ...] = (
    "id",
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
)

# DB columns coerce NULL→false; keep export aligned when client sends null.
_BOOL_NULL_AS_FALSE: frozenset[str] = frozenset(
    {
        "is_component",
        "locked",
        "mcp_enabled",
        "webhook",
        "a2a_enabled",
    }
)


def _json_safe(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if hasattr(value, "value") and hasattr(value, "name"):  # Enum
        try:
            return value.value
        except Exception:  # noqa: BLE001
            return str(value)
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:  # noqa: BLE001
            pass
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def flow_to_export_dict(flow: Any) -> dict[str, Any]:
    """Build a plain dict suitable for canonical serialization."""
    if isinstance(flow, dict):
        raw = flow
    elif hasattr(flow, "model_dump"):
        raw = flow.model_dump(mode="json")
    else:
        raw = dict(flow)

    out: dict[str, Any] = {}
    for key in FLOW_EXPORT_KEYS:
        if key in raw:
            out[key] = _json_safe(raw[key])
    # Ensure id is always a string UUID when present
    if "id" in out and out["id"] is not None:
        out["id"] = str(out["id"])
    for key in _BOOL_NULL_AS_FALSE:
        if key in out and out[key] is None:
            out[key] = False
    return out


def canonical_json_bytes(flow: Any) -> bytes:
    """Serialize flow with sorted keys, UTF-8, pretty indent=2, trailing LF.

    Pretty format keeps git diffs readable (one key/list item per line).
    Key order stays deterministic via ``sort_keys=True``.
    """
    payload = flow_to_export_dict(flow)
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.endswith("\n"):
        text += "\n"
    return text.encode("utf-8")


def sha256_raw(data: bytes) -> str:
    """SHA-256 of raw bytes, lowercase hex."""
    return hashlib.sha256(data).hexdigest()
