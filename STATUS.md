# Status — LangflowDesktopCI

Last update: 2026-08-09 (Phase 6 Wave 9 auto checks done; staff VM ACCEPTANCE remaining)

## Phase overview

| Phase | Status | Notes |
|-------|--------|--------|
| 0 Bootstrap | **done** | Pin `v1.11.2` / `baseline/v1.11.2`; Windows UI smoke still needs VM |
| 1 Discovery + ADRs | **done** | `docs/git-sot/` |
| 2 FlowGitStore | **done** | + trash-on-delete → `.langflow/trash/` |
| 3 Git engine | **done** | GitPython + leases/conflicts |
| 4 Git UI | **done** | Browser panel Wave 6–8; Windows polish follow-up |
| 5 GitLab contract | **done** | Flows template + sample CI |
| S Secrets | **partial** | Workshop + fail-closed stub; S.3–S.6 blocked |
| 6 Tauri desktop | **in progress** | Waves 0–8 + 10 done; Wave 9 auto checks done; **staff VM ACCEPTANCE** remaining |
| 7 Linux parity | **scripts ready** | Docs + start script; lease/conflict = same backend |
| 8–9 Harden / release hygiene | **docs ready** | Chaos plan, manuals, release notes, rebase guide |

## Phase 6 — Tauri desktop (detail)

| Item | Status | Notes |
|------|--------|--------|
| Wave 0 layout + docs | **done** | `desktop/` ARCHITECTURE, BOUNDARY, versions.lock, resources schema |
| Wave 1 Tauri scaffold | **done** | `src-tauri/`, splash, single-instance |
| Wave 2–3 python/git payload | **done** | python-build-standalone + MinGit / linux git |
| Wave 4 boot / watchdog | **done** | BootStage FSM, health, heartbeat, process-tree kill |
| Wave 5 branding polish | **done** | Title/about/Zeenome splash — `desktop/BRANDING.md` |
| Wave 6–7 NSIS + `.deb` | **done** | `build-windows.ps1` / `build-ubuntu.sh`; known deb ~1.6G |
| Wave 8 CI release | **done** | `.github/workflows/desktop-release.yml` + `ci-sidecar-health-smoke.sh` + `VERSION_SYNC.md` |
| Wave 9 runtime parity | **auto checks done; pending staff VM** | 2026-08-09: FE/BE wiring PASS; `cargo check` PASS; TestClient `/health` 200; live git/PAT/detach **not** VM-proven — see `desktop/ACCEPTANCE.md` |
| Wave 10 staff docs + harden | **done** | `STAFF_INSTALL.md`, orphan reaper, `scan-secrets-in-payload.sh`, `ACCEPTANCE.md` |

### Phase 6 done criteria

- Staff can install unsigned **Windows NSIS** and **Ubuntu amd64 `.deb`** artifacts named `FarhadFlowCI-desktop-vX.Y.Z-windows-nsis` or `FarhadFlowCI-desktop-vX.Y.Z-ubuntu-amd64.deb`
- App boots via Tauri shell → frozen Python sidecar + baked FE + portable git; listen `127.0.0.1` with port fallback **7860–7870**
- Install dirs: Win `%LOCALAPPDATA%\FarhadFlowCI\`; Ubuntu `/opt/farhad-flow-ci/`; user data via platformdirs / `LANGFLOW_CONFIG_DIR`
- Git SoT wizard (clone/init/PAT/secrets/history/branches/MRs/conflicts) works; **no flows clone in installer**; PAT never in webview via IPC
- Manual update only (reinstall); no auto-updater; unsigned internal OK
- Staff docs + acceptance checklist shipped (`desktop/STAFF_INSTALL.md`, `desktop/ACCEPTANCE.md`)
- Payload secret scan script green on release resources
- **Wave 9 automated checks (2026-08-09):** code-path wiring + Tauri `cargo check` + app `/health` — **done**. Full 73–82 runtime = **staff Win+Ubuntu VM + real PAT** signoff of `ACCEPTANCE.md`
- **Remaining to call Phase 6 done:** Wave 9 staff VM signoff (ACCEPTANCE.md) + Wave 8 CI green

## Phase 0 — Bootstrap (detail)

| Item | Status | Notes |
|------|--------|--------|
| Clone / tree | **done** | `/home/farhad/Projects/LangflowDesktopCI` |
| Checkout pin | **done** | `v1.11.2` |
| Remotes | **done** | `origin` + `upstream` → GitHub langflow |
| GitLab app-fork remote | **blocked** | Needs your GitLab |
| `docs/DESKTOP_DEV_WINDOWS.md` | **done** | |
| `docs/DESKTOP_DEV_LINUX.md` | **done** | Phase 7 |
| `FORK.md` | **done** | |
| Tag `baseline/v1.11.2` | **done** | Local only — **not pushed** |
| Windows `make run_cli` smoke | **blocked** | Needs Windows VM |

## Phase 7 — Linux

| Item | Status |
|------|--------|
| Path / keyring notes | **done** → `docs/DESKTOP_DEV_LINUX.md` |
| `scripts/linux/start-langflow-git.sh` | **done** |
| Lease/conflict parity | Same backend as Windows (no Linux fork) |
| Full two-way GitLab smoke | **best-effort** — run verify scripts; live GitLab optional |

## Phase 8–9 — Hardening / release

| Item | Path / status |
|------|----------------|
| Chaos 12.1–12.4 | `docs/git-sot/CHAOS_TEST_PLAN.md` (checklist; manual) |
| User + admin manual | `docs/git-sot/USER_MANUAL.md` |
| Release notes | `docs/git-sot/RELEASE_NOTES_v0.1.0-gitdesktop.md` |
| Upstream rebase | `docs/git-sot/UPSTREAM_REBASE.md` + `scripts/git-sot/list_patched_files.sh` |
| Trash on delete | **done** in `FlowGitStore.delete_flow` |
| Tag `v0.1.0-gitdesktop` | **not tagged yet** (notes ready) |

## Deferred (explicit)

- Secrets strip / inject / full scan (S.3–S.6) — pick workshop option first
- Wave 9 staff VM QA signoff of ACCEPTANCE 73–82 (auto wiring already logged; not VM pass)
- Wave 8 desktop-release CI final green (parallel)
- Auto-update channel (manual OK v1)
- Code signing
- Telemetry opt-in (12.6)
- Perf profile 500 flows (12.8)
- Graph conflict preview
- Native folder picker
- GitLab app-fork remote + push of tags

## Verify scripts (smoke)

```bash
PYTHONPATH=src/backend/base python3 scripts/git-sot/verify_atomic_write.py
PYTHONPATH=src/backend/base python3 scripts/git-sot/verify_git_engine.py
./desktop/scripts/scan-secrets-in-payload.sh
```

**Results (2026-08-08 Linux agent):** `verify_atomic_write` **OK**; `verify_git_engine` **OK** (needs GitPython — used temp venv). See `docs/git-sot/STATUS.md`.

## Push policy

Do **not** push this fork from agent sessions unless explicitly asked.

Detail: [`docs/git-sot/STATUS.md`](docs/git-sot/STATUS.md)
