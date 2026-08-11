# Spike: CRLF vs LF hash risk

## Goal

Prove SHA-256 differs when the same logical JSON is stored with CRLF vs LF — the Windows/git autocrlf trap for `flows.lock`.

## Script

```bash
python3 scripts/git-sot/spike_crlf_hash.py
```

Expected: two different hex digests; statement that CI verify must use raw bytes after LF-only write.

## Mitigation (product)

1. Serializer always emits `\n` only.
2. Flows repo `.gitattributes`: `flows/*.json text eol=lf`
3. Desktop docs: set `core.autocrlf=false` (or rely on attributes).
4. Hash **file bytes on disk**, never a platform-normalized string.

See [CANONICAL_HASH.md](../CANONICAL_HASH.md).
