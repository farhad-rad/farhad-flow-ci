#!/usr/bin/env python3
"""Spike: show SHA-256 divergence between LF and CRLF for the same JSON text."""

from __future__ import annotations

import hashlib
import json


def canonical_compact(obj: dict) -> bytes:
    """Product target: sorted keys, compact separators, LF only, UTF-8."""
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert "\r" not in text
    return (text + "\n").encode("utf-8")  # trailing LF optional; fixed choice for spike


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    sample = {"id": "00000000-0000-0000-0000-000000000001", "name": "spike", "data": {"nodes": []}}
    lf = canonical_compact(sample)
    crlf = lf.replace(b"\n", b"\r\n")
    h_lf = sha256_hex(lf)
    h_crlf = sha256_hex(crlf)
    print("LF bytes:", len(lf), "sha256:", h_lf)
    print("CRLF bytes:", len(crlf), "sha256:", h_crlf)
    print("match:" if h_lf == h_crlf else "MISMATCH (expected):", h_lf == h_crlf)
    if h_lf == h_crlf:
        raise SystemExit("unexpected: LF and CRLF hashes matched")


if __name__ == "__main__":
    main()
