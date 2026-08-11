"""Validate and unlock ``.langflow/keys.age`` (passphrase-encrypted zip of age keys)."""

from __future__ import annotations

import io
import zipfile

from pyrage import passphrase, x25519

from langflow.services.flow_git.age_keys import UnlockedKeyMaterial

MAX_KEYS_AGE_BYTES = 1_048_576  # ~1 MB upload cap

REQUIRED_ROOT_FILES = frozenset({"production.pub", "flow-ci.pub", "flow-ci.key"})


def _validate_age_recipient(text: str, *, label: str) -> str:
    key = (text or "").strip()
    if not key:
        msg = f"{label} is empty"
        raise ValueError(msg)
    try:
        x25519.Recipient.from_str(key)
    except Exception as exc:  # noqa: BLE001
        msg = f"Invalid age public key ({label}): {exc}"
        raise ValueError(msg) from exc
    return key


def _validate_age_identity(text: str, *, label: str) -> str:
    key = (text or "").strip()
    if not key:
        msg = f"{label} is empty"
        raise ValueError(msg)
    try:
        x25519.Identity.from_str(key)
    except Exception as exc:  # noqa: BLE001
        msg = f"Invalid age secret key ({label}): {exc}"
        raise ValueError(msg) from exc
    return key


def _extract_zip_root_files(zip_bytes: bytes) -> dict[str, bytes]:
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = [n.replace("\\", "/").lstrip("/") for n in zf.namelist() if not n.endswith("/")]
            root_files = [n for n in names if n and "/" not in n]
            if set(root_files) != REQUIRED_ROOT_FILES:
                msg = (
                    f"keys.age zip root must contain exactly {sorted(REQUIRED_ROOT_FILES)}; "
                    f"got {sorted(root_files)}"
                )
                raise ValueError(msg)
            out: dict[str, bytes] = {}
            for fname in REQUIRED_ROOT_FILES:
                out[fname] = zf.read(fname)
            return out
    except zipfile.BadZipFile as exc:
        msg = "keys.age decrypted payload is not a valid zip archive"
        raise ValueError(msg) from exc


def validate_and_unlock(age_blob: bytes, passphrase_str: str) -> UnlockedKeyMaterial:
    """Passphrase-decrypt *age_blob*, validate zip layout + age keys."""
    if not age_blob:
        msg = "keys.age file is empty"
        raise ValueError(msg)
    if len(age_blob) > MAX_KEYS_AGE_BYTES:
        msg = f"keys.age exceeds maximum size ({MAX_KEYS_AGE_BYTES} bytes)"
        raise ValueError(msg)
    pwd = (passphrase_str or "").strip()
    if not pwd:
        msg = "passphrase required"
        raise ValueError(msg)
    try:
        zip_bytes = passphrase.decrypt(age_blob, pwd)
    except Exception as exc:  # noqa: BLE001
        msg = "keys.age passphrase decrypt failed — wrong passphrase or corrupt file"
        raise ValueError(msg) from exc

    files = _extract_zip_root_files(zip_bytes)
    production_pub = _validate_age_recipient(files["production.pub"].decode("utf-8"), label="production.pub")
    flow_ci_pub = _validate_age_recipient(files["flow-ci.pub"].decode("utf-8"), label="flow-ci.pub")
    flow_ci_key = _validate_age_identity(files["flow-ci.key"].decode("utf-8"), label="flow-ci.key")

    return UnlockedKeyMaterial(
        production_pub=production_pub,
        flow_ci_pub=flow_ci_pub,
        flow_ci_key=flow_ci_key,
        passphrase=pwd,
        keys_age_blob=age_blob,
    )
