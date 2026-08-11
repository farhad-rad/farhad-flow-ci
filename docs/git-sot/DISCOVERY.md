# Phase 1 discovery map (v1.11.2)

Pin: `v1.11.2` / `73629e2`. No `graphify-out/` in this tree — mapped via read/grep.

## Decisions

| Topic | Decision |
|-------|----------|
| SoT | Git working tree `flows/*.json` + `flows.lock` (ADR-001) |
| Canonical JSON | Sorted keys, LF, compact UTF-8 (see [CANONICAL_HASH.md](./CANONICAL_HASH.md)) |
| File naming | `flows/<uuid>.json` (stable id, not name slug) |
| Desktop ≠ Prod | Hub-spoke; CI publishes (ADR-002) |
| Auto-commit | Yes on Save; never auto-push prod (ADR-003) |

---

## 1.1 Flow create / update / delete API

Router: `src/backend/base/langflow/api/v1/flows.py` — `APIRouter(prefix="/flows")` → under app usually `/api/v1/flows`.

| Method | Path (router) | Handler | Lines |
|--------|---------------|---------|-------|
| POST | `/` | `create_flow` → `_new_flow` | 107–121 |
| GET | `/` | `read_flows` | 124+ |
| PATCH | `/{flow_id}` | `update_flow` → `_patch_flow` | 320–421 |
| PUT | `/{flow_id}` | `upsert_flow` → `_update_existing_flow` / `_new_flow` | 424–541 |
| DELETE | `/{flow_id}` | `delete_flow` → `cascade_delete_flow` | 544–559 |
| POST | `/batch/` | `create_flows` | 562+ |
| POST | `/upload/` | upload | 610+ |
| DELETE | `/` | batch delete | 707+ |

Helpers: `src/backend/base/langflow/api/v1/flows_helpers.py`

| Helper | Role | Lines |
|--------|------|-------|
| `_new_flow` | Create + optional `_save_flow_to_fs` | 289+ |
| `_update_existing_flow` | PUT update path + FS save | 381+ |
| `_patch_flow` | Partial update + FS save | 532+ |
| `_save_flow_to_fs` | Write JSON if `fs_path` set | 181–195 |
| `_verify_fs_path` / `_get_safe_flow_path` | Jail under `data_dir/flows/<user_id>/` | 48–178 |

Delete does **not** currently remove an `fs_path` file (cascade DB only) — Phase 2 must add file+lock cleanup.

---

## 1.2 `_save_flow_to_fs` / `fs_path`

```181:195:src/backend/base/langflow/api/v1/flows_helpers.py
async def _save_flow_to_fs(flow: Flow, user_id: UUID, storage_service: StorageService) -> None:
    """Save flow data to the filesystem at the validated path."""
    if not flow.fs_path:
        return
    ...
        async with aiofiles.open(str(safe_path), "w") as f:
            await f.write(flow.model_dump_json())
```

- Relative `fs_path` resolves to `{storage.data_dir}/flows/{user_id}/{fs_path}`.
- Absolute paths allowed only if still inside that jail.
- Traversal (`..`), null bytes rejected.
- Serializer = Pydantic `model_dump_json()` — **not** Git-SoT canonical.

---

## 1.3 `LANGFLOW_LOAD_FLOWS_PATH` startup

| Piece | Path | Lines |
|-------|------|-------|
| Setting | `src/lfx/src/lfx/services/settings/groups/components.py` `load_flows_path` | 27–38 |
| Env | `LANGFLOW_LOAD_FLOWS_PATH` via `env_prefix="LANGFLOW_"` | `settings/base.py:111` |
| Loader | `load_flows_from_directory()` | `initial_setup/setup.py:1022–1052` |
| Upsert | `upsert_flow_from_file` | `setup.py:1236+` |
| Startup call | `main.py` lifespan | ~442 |
| Preload | `preload.py` also invokes loader | ~205 / ~287 |
| Poll sync | `sync_flows_from_fs()` mtime → DB | `setup.py:1587–1629`; scheduled in `main.py:447` |

Loader behavior: if `load_flows_path` set, iterate `*.json`, upsert into superuser default folder. Related flags:

- `LANGFLOW_LOAD_FLOWS_OVERWRITE_ON_NAME_MATCH`
- `LANGFLOW_LOAD_FLOWS_PRESERVE_VARIABLE_BINDINGS`

**Git mode conflict:** Phase 2 must disable or subsume LOAD_FLOWS_PATH + `sync_flows_from_fs` so they do not fight FlowGitStore.

---

## 1.4 Flow model fields + constraints

File: `src/backend/base/langflow/services/database/models/flow/model.py`

| Model | Notable fields | Lines |
|-------|----------------|-------|
| `FlowBase` | name, description, icon*, data, is_component, updated_at, webhook, endpoint_name, tags, locked, mcp_enabled, action_*, access_type, flow_type, a2a_* | 56–115 |
| `Flow` (table) | id UUID PK, data JSON, user_id FK, folder_id, workspace_id, **fs_path**, unique (user_id,name), unique (user_id,endpoint_name) | 221–249 |
| `FlowCreate` | optional id, user_id, folder_id, workspace_id, fs_path | 252–261 |
| `FlowUpdate` | partial incl. fs_path | 303–318 |
| `FlowRead` / `FlowHeader` | API shapes | 264–300 |

---

## 1.5 Frontend save / autosave

| Piece | Path | Notes |
|-------|------|-------|
| Manual save | `src/frontend/src/hooks/flows/use-save-flow.ts` | Builds payload → `usePatchUpdateFlow` |
| PATCH client | `.../queries/flows/use-patch-update-flow.ts:33` | `api.patch(`${getURL("FLOWS")}/${id}`, payload)` |
| Autosave hook | `.../hooks/flows/use-autosave-flow.ts` | Debounce `autoSavingInterval`; respects `autoSaving` + write perm |
| Wire-up | `PageComponent/index.tsx` | `useAutoSaveFlow` ~101; effect sets store ~365; triggers ~571 |
| Flow page save | `pages/FlowPage/index.tsx` | `useSaveFlow` |
| Settings | `UiSettings.auto_saving` / `auto_saving_interval` | `lfx/.../groups/ui.py:9–12` → env `LANGFLOW_AUTO_SAVING*` |

Default interval: **1000 ms**.

---

## 1.6 Auth / API key desktop defaults

| Setting | Default | File |
|---------|---------|------|
| `AUTO_LOGIN` | `True` (dev bootstrap; warn for prod) | `lfx/.../settings/auth.py:83–91` |
| `skip_auth_auto_login` | `False` | same |
| `WEBHOOK_AUTH_ENABLE` | `True` | same |
| env prefix | `LANGFLOW_` | `auth.py` + `base.py` model_config |

Local Desktop can keep auto-login for UX; real multi-user later. Prod headless stays CI-side (ADR-002).

---

## 1.7 Settings / env pattern

- Base: `src/lfx/src/lfx/services/settings/base.py` — `SettingsConfigDict(..., env_prefix="LANGFLOW_")`
- Auth: separate `AuthSettings` also `LANGFLOW_`
- Feature flags: `LANGFLOW_FEATURE_`
- Grouped settings under `services/settings/groups/` (`components`, `ui`, `database`, `paths`, …)
- Field `load_flows_path` → env `LANGFLOW_LOAD_FLOWS_PATH`

**Planned Phase 2 knobs (not implemented):** `LANGFLOW_GIT_FLOWS_DIR`, `LANGFLOW_GIT_ENABLED`, `LANGFLOW_GIT_AUTO_COMMIT`.

---

## Spikes

| Spike | Doc / script |
|-------|----------------|
| Existing save-to-fs | [`spikes/SPIKE-save-flow-to-fs.md`](./spikes/SPIKE-save-flow-to-fs.md) |
| LOAD_FLOWS_PATH | [`spikes/SPIKE-load-flows-path.md`](./spikes/SPIKE-load-flows-path.md) |
| CRLF hash risk | [`spikes/SPIKE-crlf-hash.md`](./spikes/SPIKE-crlf-hash.md) + `scripts/git-sot/spike_crlf_hash.py` |

---

## Hook points for Phase 2 (no impl yet)

1. Intercept `_new_flow` / `_patch_flow` / `_update_existing_flow` / delete for disk-first writes.
2. Replace or bypass startup `load_flows_from_directory` + `sync_flows_from_fs` when git enabled.
3. After successful Save path, optional auto-commit (Phase 3) from same service.
4. Ensure UI Save continues to use PATCH — backend owns git/fs behavior.
