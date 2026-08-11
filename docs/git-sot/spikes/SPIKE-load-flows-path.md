# Spike: `LANGFLOW_LOAD_FLOWS_PATH`

## Goal

Document startup folder → DB load path for conflict analysis with Git-SoT.

## Knob

| Item | Value |
|------|--------|
| Setting | `settings.load_flows_path` |
| Env | `LANGFLOW_LOAD_FLOWS_PATH` |
| Code | `load_flows_from_directory()` in `initial_setup/setup.py` ≈1022–1052 |
| Boot | `main.py` ≈442; also preload path |

## Behavior

1. If unset → return.
2. Resolve superuser; ensure default folder.
3. For each `*.json` in directory: read UTF-8, `upsert_flow_from_file(content, stem, …)`.
4. Stem used as filename key in upsert (not necessarily UUID).

Related:

- `LANGFLOW_LOAD_FLOWS_OVERWRITE_ON_NAME_MATCH` (default false)
- `LANGFLOW_LOAD_FLOWS_PRESERVE_VARIABLE_BINDINGS` (default true)
- Background `sync_flows_from_fs()` polls flows with non-null `fs_path` and may push file mtime → DB fields

## Manual try

```bash
mkdir -p /tmp/lf-load-spike
# drop any exported flow JSON as foo.json
export LANGFLOW_LOAD_FLOWS_PATH=/tmp/lf-load-spike
uv run langflow run   # or make run_cli
# UI should show upserted flows for superuser
```

## Conflict with Git-SoT

| LOAD_FLOWS_PATH | Git-SoT |
|-----------------|---------|
| Directory of arbitrary JSON stems | `flows/<uuid>.json` + lock |
| Upserts into DB as SoT-ish seed | Tree is SoT; DB cache rebuild |
| `sync_flows_from_fs` can overwrite DB from user data_dir files | Would fight disk-first Save |

**Phase 2 rule:** when `LANGFLOW_GIT_ENABLED`, skip or strictly subordinate LOAD_FLOWS + `sync_flows_from_fs`; rebuild from `LANGFLOW_GIT_FLOWS_DIR` instead.
