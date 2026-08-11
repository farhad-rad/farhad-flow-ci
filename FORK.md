# LangflowDesktopCI — Git-SoT fork

This tree is a **fork of Langflow** pinned for Desktop + Git working-tree Source of Truth work.

| Item | Value |
|------|--------|
| Upstream | https://github.com/langflow-ai/langflow.git |
| Pin tag | `v1.11.2` |
| Baseline local tag | `baseline/v1.11.2` |
| App package version | `1.11.2` (`pyproject.toml`) |
| Ship path (v1) | Browser + scripts still valid; **Phase 6 Tauri desktop = in progress** (`desktop/`) |
| Flows SoT | Separate GitLab **flows-only** repo (not this app tree; not bundled in Tauri installer) |

## Phase 6 — Tauri (in progress → near done)

| Item | Value |
|------|--------|
| Status | **in progress** — Waves 0–7 + Wave 10 landed; **remaining = Wave 9 VM signoff + Wave 8 CI** |
| Tree | [`desktop/`](desktop/) — ARCHITECTURE, BOUNDARY, STAFF_INSTALL, ACCEPTANCE, `versions.lock.json` |
| Targets | Windows NSIS + Ubuntu `.deb` (unsigned, staff-only) |
| Brand / id | Farhad Flow CI / `FarhadFlowCI` / `ci.zeenome.farhadflow` |
| Install dirs | Win `%LOCALAPPDATA%\FarhadFlowCI\`; Ubuntu `/opt/farhad-flow-ci/` |
| Config | platformdirs + optional `LANGFLOW_CONFIG_DIR` |
| Artifacts | `FarhadFlowCI-desktop-vX.Y.Z-windows-nsis` / `FarhadFlowCI-desktop-vX.Y.Z-ubuntu-amd64.deb` (~1.6G deb known) |

### Phase 6 done criteria

1. Staff install + launch works on Win + Ubuntu without system Python/Node/Git.
2. Boot FSM reaches READY; webview on loopback; port fallback 7860–7870.
3. Runtime Git SoT parity (wizard, PAT outside webview, MRs/conflicts/branches/history) — **VM signoff via `desktop/ACCEPTANCE.md` (not claimed yet)**.
4. Release artifacts named as above; update = manual reinstall; [`desktop/STAFF_INSTALL.md`](desktop/STAFF_INSTALL.md) shipped.
5. Wave 8 desktop-release CI green (parallel track).

## Remotes

- `upstream` → https://github.com/langflow-ai/langflow.git (canonical upstream)
- `origin` → currently same as upstream until a GitLab app-fork remote is added

Do **not** confuse this app fork with the flows-only GitLab repo used for publish.

## Docs

- Windows boot: [`docs/DESKTOP_DEV_WINDOWS.md`](docs/DESKTOP_DEV_WINDOWS.md)
- Linux boot: [`docs/DESKTOP_DEV_LINUX.md`](docs/DESKTOP_DEV_LINUX.md)
- Tauri desktop: [`desktop/README.md`](desktop/README.md) · [`desktop/ARCHITECTURE.md`](desktop/ARCHITECTURE.md) · [`desktop/BOUNDARY.md`](desktop/BOUNDARY.md) · [`desktop/BRANDING.md`](desktop/BRANDING.md)
- Staff install: [`desktop/STAFF_INSTALL.md`](desktop/STAFF_INSTALL.md)
- VM acceptance: [`desktop/ACCEPTANCE.md`](desktop/ACCEPTANCE.md)
- Git-SoT discovery / ADRs / manuals: [`docs/git-sot/`](docs/git-sot/)
- Phase status: [`STATUS.md`](STATUS.md)

## Hygiene

- Prefer stacked commits for Desktop patches.
- Rebase onto newer upstream **stable** tags, not `main` tip, unless intentional.
- Never auto-push Desktop commits to the production flows branch (see ADR-003).
