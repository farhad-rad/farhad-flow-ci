# Git-SoT STATUS

Pin: `v1.11.2` · Last update: 2026-08-08

## Phase progress

| Phase | Status |
|-------|--------|
| 0 Bootstrap | done (Windows UI smoke blocked on VM) |
| 1 Discovery + ADRs | done |
| 2 FlowGitStore core | done (+ `.langflow/trash/` on delete) |
| 3 GitPython engine | done (Wave 4–5) |
| 4 Git UI | done Wave 6–8 (browser); 8.5–8.6 need Windows VM |
| 5 GitLab contract | done (flows template) |
| S Secrets | workshop + fail-closed stub; S.3–S.6 blocked |
| 6 Windows package | deferred (scripts only; no Tauri/installer) |
| 7 Linux parity | **scripts ready** — `docs/DESKTOP_DEV_LINUX.md`, `scripts/linux/start-langflow-git.sh` |
| 8 Hardening docs | **done** — chaos plan + manuals |
| 9 Upstream hygiene | **done** — `UPSTREAM_REBASE.md` + `list_patched_files.sh` |

## Phase 4 — Desktop Git UI (summary)

Ship path = OSS UI + local backend (browser). Tauri later.

- Panel + wizard + auth + conflicts + shortcuts + onboarding — landed
- Push disabled on prod / unresolved conflicts / offline
- Follow-up: native folder picker, Windows High-DPI / AV rename (VM)

See earlier wave checklist in git history if needed; Wave 6–8 items marked done except 8.5–8.6.

## Phase 7 — Linux

| Item | Status |
|------|--------|
| 11.1 Path/keyring docs | done |
| 11.2 Debounce/FS notes | done (timer debounce; no inotify SoT dep) |
| 11.3 Run script | `scripts/linux/start-langflow-git.sh` |
| 11.4 Two-way sync smoke | best-effort (verify scripts; live GitLab optional) |
| 11.5 Lease/conflict parity | same backend — no Linux-specific code |

## Phase 8–9 docs

| Doc | Path |
|-----|------|
| Chaos 12.1–12.4 | [`CHAOS_TEST_PLAN.md`](./CHAOS_TEST_PLAN.md) |
| User + admin | [`USER_MANUAL.md`](./USER_MANUAL.md) |
| Release notes | [`RELEASE_NOTES_v0.1.0-gitdesktop.md`](./RELEASE_NOTES_v0.1.0-gitdesktop.md) |
| Rebase hygiene | [`UPSTREAM_REBASE.md`](./UPSTREAM_REBASE.md) |

## Phase S — secrets

| Item | Status |
|------|--------|
| S.1–S.2 Workshop + matrix | done — **impl blocked on user pick** |
| Fail-closed stub | done (`secret_scan.py` on commit) |
| S.3–S.6 strip/inject/scan | blocked |
| S.7 Red-team | not started |

**Gate:** no real customer flows with live keys to GitLab until S.3–S.6.

## Enable

```bash
export LANGFLOW_GIT_ENABLED=true
export LANGFLOW_GIT_FLOWS_DIR=/path/to/flows-repo
export LANGFLOW_GIT_AUTO_COMMIT=false
# optional PAT:
# export LANGFLOW_GIT_PAT=glpat-...
```

Linux: `./scripts/linux/start-langflow-git.sh /path/to/flows-repo`

## Deferred

- Secrets strip/inject (S.3–S.6)
- Tauri shell / Windows installer / code signing / auto-update
- Windows VM QA (8.5–8.6, packaging smoke)
- Telemetry 12.6 · perf 500 flows 12.8
- Graph conflict preview · native folder picker
- Tag + push `v0.1.0-gitdesktop` (notes ready, not tagged by agent)

## Smoke / verify results

```bash
PYTHONPATH=src/backend/base python3 scripts/git-sot/verify_atomic_write.py
# GitPython required:
PYTHONPATH=src/backend/base python3 scripts/git-sot/verify_git_engine.py
```

| Script | Result | When |
|--------|--------|------|
| `verify_atomic_write.py` | **OK** (incl. trash backup assert) | 2026-08-08 Linux agent |
| `verify_git_engine.py` | **OK** (temp venv + GitPython; system python lacked GitPython) | 2026-08-08 Linux agent |

Note: Desktop patches still **uncommitted** on detached `v1.11.2` — `list_patched_files.sh` lists working-tree hotspots until stacked commits exist.

## Gaps / follow-ups

- Native Windows folder picker (Tauri / shell)
- 8.5–8.6 Windows VM QA
- Phase S: pick storage option → S.3–S.6
- Phase 6 packaging
- Chaos 12.1–12.4 manual sign-off on Linux + Windows
