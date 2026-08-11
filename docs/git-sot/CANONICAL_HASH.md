# Canonical hash (Desktop ↔ CI)

Desktop and GitLab CI **must** compute the same SHA-256 for a flow file. Mismatch ⇒ CI fails; do not “fix” by rehashing differently per OS.

## Rules

1. **Serialize** flow JSON with **sorted object keys** (recursive).
2. **Newlines** = Unix **LF** only (`\n`). No CRLF in committed flow JSON.
3. **Compact** JSON: `separators=(',', ':')` style after key-sort, UTF-8, no BOM. No trailing whitespace games.
4. **Hash** = SHA-256 of the **raw file bytes** as stored in git (bytes on disk after write), hex lowercase.
5. Write that hex into `flows.lock` under `flows.<id>.sha256`.

## Pseudocode

```text
bytes = canonical_json_bytes(flow)   # sorted keys, LF, UTF-8, compact
path  = flows/<uuid>.json
atomic_write(path, bytes)
sha   = sha256(bytes).hexdigest()
flows.lock.flows[id].sha256 = sha
flows.lock.flows[id].path   = path
```

## File naming (decided)

| Choice | Value |
|--------|--------|
| Path | `flows/<uuid>.json` |
| ID | Stable flow UUID (same as Langflow `Flow.id`) |
| Not used | Name slugs (renames break git history identity) |

UUID filenames are immutable across renames; display name lives inside JSON + DB cache.

## CI verify

On the production branch, CI:

1. Reads `flows.lock` (`version` == 1).
2. For each entry, SHA-256 of file at `path`.
3. Compares to lock; any mismatch fails the job.

## Windows pitfall

Editors or git `core.autocrlf=true` can turn LF → CRLF and break hashes. Prefer `.gitattributes` with `flows/*.json text eol=lf` in the flows repo.

See spike: [`spikes/SPIKE-crlf-hash.md`](./spikes/SPIKE-crlf-hash.md).

## Upstream note

Upstream `_save_flow_to_fs` uses `flow.model_dump_json()` — **not** this canonical form. Phase 2 `FlowGitStore` must not rely on that serializer for lock hashes.
