# Acceptance checklist — Farhad Flow CI desktop

Staff sign-off for **Windows VM** and **Ubuntu VM**. Covers Wave 9 runtime parity + Wave 10 install/hardening docs.

**Do not mark Wave 9 passed until both OS columns are checked on real VMs.** CI artifact smoke ≠ this checklist.

Related: [`STAFF_INSTALL.md`](STAFF_INSTALL.md) · Wave 9 plan items 73–82.

| # | Check | Win VM | Ubuntu VM | Notes / evidence |
|---|-------|:------:|:---------:|------------------|
| A0 | Clean VM OS version recorded (Win 10/11 / Ubuntu 22.04+) | ☐ | ☐ | |
| A1 | Install unsigned artifact from trusted channel (NSIS / `.deb`) | ☐ | ☐ | hash / tag: |
| A2 | Launch → splash → READY → UI (no system Python/Node/Git required) | ☐ | ☐ | |
| A3 | Port fallback works if 7860 busy (or documents busy-all failure) | ☐ | ☐ | |
| A4 | Sidecar log written under `{config_dir}/logs/sidecar.log` | ☐ | ☐ | |
| A5 | Bundled git used (`git --version` under `resources/git`) | ☐ | ☐ | |
| A6 | Uninstall keeps `{config_dir}/flows-repo` | ☐ | ☐ | |
| A7 | Manual update (over-install or uninstall+reinstall) keeps userdata | ☐ | ☐ | |
| A8 | Staff understand unsigned + AUTO_LOGIN trust boundary | ☐ | ☐ | |

## Wave 9 — Git SoT parity

| # | Check | Win VM | Ubuntu VM | Notes / evidence |
|---|-------|:------:|:---------:|------------------|
| 73 | First-run Git setup wizard: connect remote, clone into `{config_dir}/flows-repo` | ☐ | ☐ | Auto: `GitSetupGate` + `GitSetupWizard` + routes/`/setup/*` wired (2026-08-09). **Staff:** real clone + remote + PAT on VM. |
| 74 | PAT save/clear (keyring) **and** env fallback `LANGFLOW_GIT_PAT` | ☐ | ☐ | Auto: FE credentials UI + BE `credentials.py` keyring/env. **Staff:** keyring round-trip + env-only fallback on VM. |
| 75 | Secrets pubkey save / sync / detach | ☐ | ☐ | Auto: settings page + `/secrets-pubkey` + `/secrets/sync` wired. **Staff:** save/sync/clear on VM. |
| 76 | History: status, commit, discard, pull/push/sync, graph | ☐ | ☐ | Auto: `/git/history` + BE `/status` `/commit` `/discard` `/pull` `/push` `/log`. **Staff:** live ops on VM. |
| 77 | Branches: list merge local/remote, create, checkout, delete local, sync wipe | ☐ | ☐ | Auto: `/git/branches` + BE branch CRUD/sync. **Staff:** live branch ops on VM. |
| 78 | Merge requests: list search/filters, wizard, detail, merge/close | ☐ | ☐ | Auto: MR routes + BE `/merge-requests*` + FE hooks. **Staff:** GitLab PAT + real MRs. |
| 79 | Conflict resolver: prepare → IDE resolve → commit/push source | ☐ | ☐ | Auto: `/git/conflicts` + prepare/finish/abort APIs + `GitBusyBanner`. **Staff:** real conflict flow. |
| 80 | Loading panels / busy banners correct under webview | ☐ | ☐ | Auto: `GitLoadingPanel` / `GitBusyBanner` used on history/branches/MR/conflicts. **Staff:** confirm under Tauri webview. |
| 81 | Production branch guard; auto-commit **off** | ☐ | ☐ | Auto: `PRODUCTION_BRANCH_GUARD` + `LANGFLOW_GIT_AUTO_COMMIT=false`. **Staff:** Save does **not** commit; History manual commit. |
| 82 | Detach danger zone works → returns to setup wizard | ☐ | ☐ | Auto: settings detach UI + `POST /setup/detach` wired (**not executed** — destructive). **Staff:** detach → wizard on VM. |

### Automated verification log (agent, 2026-08-09) — **not** VM pass

| Check | Result | Evidence |
|-------|--------|----------|
| FE route wiring (`/git/history|branches|merge-requests|conflicts|settings`) | **PASS** | `src/frontend/src/routes.tsx` |
| `GitSetupGate` wraps authenticated app | **PASS** | `AppAuthenticatedPage` |
| FE pages + hooks present (setup/PAT/secrets/history/branches/MR/conflicts/detach) | **PASS** | pages under `pages/GitPage/`; `use-git-*.ts` |
| BE `git_router` included | **PASS** | `api/v1/__init__.py` + `api/router.py` |
| Critical BE routes registered | **PASS** | import `langflow.api.v1.git` — health/setup/credentials/secrets/status/commit/branches/MRs/conflicts/production-branch/detach |
| `cargo check` (`desktop/src-tauri`) | **PASS** | Finished `dev` profile |
| App `/health` (TestClient, no live server) | **PASS** | HTTP 200 `{"status":"ok"}` |
| Live `127.0.0.1:7860` git smoke | **SKIP** | No backend already up; full create_app git calls need DB/auth — not long-started |
| Destructive detach | **SKIP** | Intentionally not called |
| Win/Ubuntu VM + real PAT end-to-end | **PENDING staff** | Columns above stay ☐ |

## Hardening spot-checks

| # | Check | Win VM | Ubuntu VM | Notes / evidence |
|---|-------|:------:|:---------:|------------------|
| H1 | After forced kill of shell (`taskkill` / `kill -9`), relaunch clears orphan Python (reaper) | ☐ | ☐ | |
| H2 | Close app → no leftover `python -m langflow` for this install | ☐ | ☐ | |
| H3 | `scan-secrets-in-payload.sh` run on resources used for this build → exit 0 | ☐ | ☐ | CI or local |

## Sign-off

| Field | Value |
|-------|-------|
| Build / tag | |
| Windows tester + date | _(pending — do not claim pass)_ |
| Ubuntu tester + date | _(pending — do not claim pass)_ |
| Blockers | Wave 9 auto wiring + `cargo check` + `/health` done; **remaining = staff Win+Ubuntu VM signoff with real GitLab PAT** |

Phase 6 “done” still requires this table signed **and** Wave 8 desktop-release CI green.
