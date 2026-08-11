"""Fail-closed raw secret pattern scan (Phase S stub).

Blocks commit when known key-shaped literals appear in flow JSON.
Does not strip or inject — see docs/git-sot/secrets/FAIL_CLOSED_STUB.md.
"""

from __future__ import annotations

import re
from pathlib import Path

from langflow.services.flow_git.exceptions import SecretPatternBlockedError

# Deliberately conservative literal patterns (stub). Expand in S.6.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("openai_sk", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("github_pat", re.compile(r"\bghp_[A-Za-z0-9]{36}\b")),
    ("gitlab_pat", re.compile(r"\bglpat-[A-Za-z0-9_\-]{20,}\b")),
    ("aws_akia", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b")),
    ("pem_private_key", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
]


def _iter_scan_paths(repo_root: Path, paths: list[str] | None) -> list[Path]:
    root = repo_root.resolve()
    if paths:
        out: list[Path] = []
        for rel in paths:
            p = (root / rel).resolve()
            if not str(p).startswith(str(root)):
                continue
            if p.is_file() and p.suffix == ".json" and "flows" in p.parts:
                out.append(p)
        return out
    flows = root / "flows"
    if not flows.is_dir():
        return []
    return sorted(flows.glob("*.json"))


def scan_text_for_secret_patterns(text: str) -> list[str]:
    """Return pattern ids that matched (empty if clean)."""
    hits: list[str] = []
    for name, pat in _PATTERNS:
        if pat.search(text):
            hits.append(name)
    return hits


def assert_no_raw_secret_patterns(repo_root: Path | str, paths: list[str] | None = None) -> None:
    """Raise SecretPatternBlockedError if any flow JSON matches stub patterns."""
    root = Path(repo_root)
    findings: list[dict[str, str]] = []
    for path in _iter_scan_paths(root, paths):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        hits = scan_text_for_secret_patterns(text)
        if hits:
            rel = str(path.relative_to(root.resolve()))
            findings.append({"path": rel, "patterns": ",".join(hits)})

    if not findings:
        return

    detail = "; ".join(f"{f['path']} [{f['patterns']}]" for f in findings)
    raise SecretPatternBlockedError(
        "Commit blocked: raw secret pattern(s) in flow JSON. "
        f"Remove keys or wait for Phase S strip/inject. Hits: {detail}",
        code="GIT_SECRET_PATTERN",
    )
