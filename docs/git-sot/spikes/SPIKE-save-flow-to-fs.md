# Spike: call existing `_save_flow_to_fs`

## Goal

Confirm how upstream writes a flow JSON when `fs_path` is set — without implementing FlowGitStore.

## Behavior (code)

Source: `src/backend/base/langflow/api/v1/flows_helpers.py` `_save_flow_to_fs` (≈181–195).

1. No-op if `flow.fs_path` is falsy.
2. Resolve safe path under `{storage.data_dir}/flows/{user_id}/`.
3. `mkdir -p` parent; write `flow.model_dump_json()` via aiofiles text mode `"w"`.

Triggered after DB commit paths in `_new_flow` / `_patch_flow` / `_update_existing_flow` when `fs_path` present.

## How to exercise (manual)

### A. Via API (running Langflow)

```http
POST /api/v1/flows/
Content-Type: application/json

{
  "name": "spike-fs",
  "data": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}},
  "fs_path": "spike-fs.json"
}
```

Then PATCH updates with same `fs_path`. File appears under Langflow data dir:

`{LANGFLOW_CONFIG_DIR or default}/flows/{user_uuid}/spike-fs.json`

### B. Via unit harness (optional)

Upstream test `src/backend/tests/unit/api/v1/test_flows_helpers.py` already covers OSError → 500. Prefer reading that over standing up full app when only verifying path logic.

## Findings for Phase 2

| Upstream | Git-SoT need |
|----------|----------------|
| User-scoped data_dir path | Shared git `flows/<uuid>.json` jail |
| `model_dump_json()` | Canonical sorted-keys + LF bytes |
| Optional `fs_path` | Always set / derived when `LANGFLOW_GIT_ENABLED` |
| Text open `"w"` | Atomic staging + rename; binary/UTF-8 explicit newline |

**Do not** reuse `_save_flow_to_fs` as the production Git writer — wrap or replace with `FlowGitStore.atomic_write`.
