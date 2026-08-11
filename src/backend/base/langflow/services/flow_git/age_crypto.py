"""age multi-recipient encrypt/decrypt for git-tracked secrets."""

from __future__ import annotations

import base64
import json
from typing import Any

from pyrage import decrypt, encrypt, x25519

ALG = "age-v1"


def _b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def _recipients_from_strings(recipients: list[str]) -> list[x25519.Recipient]:
    out: list[x25519.Recipient] = []
    for text in recipients:
        key = (text or "").strip()
        if not key:
            msg = "empty age recipient"
            raise ValueError(msg)
        try:
            out.append(x25519.Recipient.from_str(key))
        except Exception as exc:  # noqa: BLE001
            msg = f"Invalid age recipient: {exc}"
            raise ValueError(msg) from exc
    if not out:
        msg = "no age recipients"
        raise ValueError(msg)
    return out


def _identity_from_string(identity: str) -> x25519.Identity:
    key = (identity or "").strip()
    if not key:
        msg = "empty age identity"
        raise ValueError(msg)
    try:
        return x25519.Identity.from_str(key)
    except Exception as exc:  # noqa: BLE001
        msg = f"Invalid age identity: {exc}"
        raise ValueError(msg) from exc


def encrypt_json(plaintext_obj: dict[str, Any], recipients: list[str]) -> dict[str, str]:
    """Encrypt JSON object with age multi-recipient; envelope uses ``alg: age-v1``."""
    raw = json.dumps(plaintext_obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    recips = _recipients_from_strings(recipients)
    ciphertext = encrypt(raw, recips)
    return {"alg": ALG, "ciphertext": _b64e(ciphertext)}


def decrypt_json(envelope: dict[str, Any], identity: str) -> dict[str, Any]:
    """Decrypt age envelope with a single identity (``flow-ci.key``)."""
    alg = envelope.get("alg")
    if alg != ALG:
        msg = f"Unsupported secrets alg: {alg}"
        raise ValueError(msg)
    ct = envelope.get("ciphertext")
    if not isinstance(ct, str) or not ct.strip():
        msg = "missing ciphertext"
        raise ValueError(msg)
    ident = _identity_from_string(identity)
    raw = decrypt(_b64d(ct), [ident])
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        msg = "decrypted secrets payload must be an object"
        raise TypeError(msg)
    return data
