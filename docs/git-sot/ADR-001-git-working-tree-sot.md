# ADR-001: Git working tree is Source of Truth

## Status

Accepted

## Context

Langflow stores flows in a local DB (e.g. SQLite). Multi-user Desktop + GitLab publish need a durable, diffable, reviewable artifact. Dual SoT (DB vs files) causes drift and silent overwrite.

Upstream already has optional `fs_path` + `_save_flow_to_fs` and `LANGFLOW_LOAD_FLOWS_PATH`, but DB remains authoritative for normal UI Save. Git-SoT Desktop reverses that when git mode is on.

## Decision

The **git working tree** under `flows/<uuid>.json` (plus `flows.lock`) is the **Source of Truth** for flow definitions.

- On Save (git mode): write disk first (canonical JSON), update lock, then upsert DB cache.
- On startup (git mode): rebuild/refresh DB from the tree; open-edit gates on hash drift.
- SQLite is a **cache**, not SoT.

## Consequences

- Conflict and review happen on files/MRs, not opaque DB rows.
- Canonical hash rules ([CANONICAL_HASH.md](./CANONICAL_HASH.md)) are mandatory.
- Desktop must jail paths under the flows directory and refuse traversal.
- Upstream `_save_flow_to_fs` (writes under `data_dir/flows/<user_id>/…` via `model_dump_json()`) is a hook to study, not the final serializer.
