# Farhad Flow CI — Desktop

Staff-only Tauri 2 shell for **Farhad Flow CI** (Windows NSIS + Ubuntu `.deb`).

This tree holds the native shell, frozen runtime payload layout, and packaging docs. End users do **not** need system Python, Node, or Git — those ship under `resources/` (filled by later build waves).

## Quick map

| Path | Role |
|------|------|
| `src-tauri/` | Tauri 2 / Rust app (Wave 1+) |
| `splash/` | Boot HTML (`frontendDist`) until backend READY |
| `scripts/` | OS packaging entrypoints (Wave 6–7) |
| `resources/` | Bundled python / venv / frontend / git / env |
| `ARCHITECTURE.md` | Boot FSM, paths, env, port fallback |
| `BOUNDARY.md` | Native vs webview trust boundary |
| `BRANDING.md` | Wave 5 title/icon/about + store hide + GitSetupGate |
| `STAFF_INSTALL.md` | Staff install, PAT scopes, update SOP, troubleshooting, security |
| `ACCEPTANCE.md` | Win + Ubuntu VM checklist (Wave 9 — unsigned until VM) |
| `versions.lock.json` | Pinned toolchain / payload versions |

## Dev — splash shell (Wave 1)

From `desktop/` (Node 22 + Rust stable; Linux needs `libwebkit2gtk-4.1-dev`):

```bash
cd desktop
npm install
npm run dev                 # splash only; prod spawn waits Wave 2/4
FARHAD_FLOW_CI_DEV=1 npm run dev   # skip spawn; navigate to http://127.0.0.1:7860
```

Optional checks:

```bash
npm run check               # cargo check
npx tauri build --no-bundle # binary without NSIS/deb
```

`FARHAD_FLOW_CI_DEV=1` attaches to an already-running backend (staff). Prod path still calls `sidecar::spawn_prod` (Wave 4 fills real kill/spawn). Close always hits `sidecar::shutdown`.

## Staff install

**[`STAFF_INSTALL.md`](STAFF_INSTALL.md)** — Win NSIS + Ubuntu deb, PAT scopes, first clone, troubleshooting, manual update, security, size/cold-start.  
**[`ACCEPTANCE.md`](ACCEPTANCE.md)** — VM signoff checklist (Wave 9 items). **Not claimed passed.**

1. Install the unsigned artifact for your OS (names below).
2. Launch **Farhad Flow CI** from Start Menu / app menu.
3. First run: Git SoT wizard clones/inits the flows repo; GitLab PAT stays outside the webview (see `BOUNDARY.md`).
4. Updates: uninstall/reinstall or install-over — no auto-updater; userdata kept.
5. Uninstall removes **install dir only** — does **not** wipe `{config_dir}/flows-repo`.

### Install directories

| OS | App install dir | User config / flows |
|----|-----------------|---------------------|
| Windows | selectable (NSIS; Program Files / other drive / per-user) | `%APPDATA%\zeenome\FarhadFlowCI\` |
| Ubuntu | `/opt/farhad-flow-ci/` | `~/app_data/zeenome/farhad-flow-ci/` |

Flows clone lives under `{config_dir}/flows-repo` by default — **not** inside the installer payload. Override config root: `LANGFLOW_CONFIG_DIR`.

### Release artifact names

```
FarhadFlowCI_X.Y.Z_x64-setup.exe          # Windows NSIS (canonical)
FarhadFlowCI-desktop-vX.Y.Z-windows-nsis.exe  # channel alias (same file)
farhad-flow-ci_X.Y.Z_amd64.deb            # Ubuntu dpkg / Tauri bundler
FarhadFlowCI-desktop-vX.Y.Z-ubuntu-amd64.deb  # Ubuntu staff channel alias
```

Tauri raw NSIS name uses spaces (`Farhad Flow CI_X.Y.Z_x64-setup.exe`); `build-windows.ps1` renames into `desktop/dist/`. `build-ubuntu.sh` copies both deb names into `desktop/dist/`.

## Build scripts

### Wave 2 — frozen payload (python + venv + FE)

| Script | Role |
|--------|------|
| `scripts/fetch-python-standalone.sh` / `.ps1` | Pin from `versions.lock.json` → `resources/python/` |
| `scripts/bake-frontend.sh` | `npm run build` + copy → `resources/frontend/` |
| `scripts/freeze-venv.sh` / `.ps1` | venv + `uv sync` → `resources/venv/` + launchers + `MANIFEST.sha256` |
| `scripts/write-manifest.sh` / `.ps1` | Critical-file checksums |
| `scripts/build-payload-linux.sh` | Orchestrator (Linux CI) |
| `scripts/build-payload-windows.ps1` | Orchestrator (Windows CI) |
| `scripts/SIDECAR.md` | argv / env / PATH contract |

```bash
./desktop/scripts/build-payload-linux.sh
SMOKE_ONLY=1 ./desktop/scripts/build-payload-linux.sh
SKIP_NPM_BUILD=1 ./desktop/scripts/bake-frontend.sh
```

```powershell
.\desktop\scripts\build-payload-windows.ps1
.\desktop\scripts\build-payload-windows.ps1 -SmokeOnly
```

### Wave 3 — portable git

- `scripts/vendor-git.sh` / `scripts/vendor-git.ps1` — fill `resources/git/`
- `scripts/verify-bundled-git.sh` — prove bundled PATH/`GIT_EXEC_PATH`
- `scripts/git-env.md` + `scripts/sidecar-git-env.env.example` — sidecar-only env
- `scripts/manifest-git-entries.sh` — Wave 2 `MANIFEST.sha256` hook

### Wave 6 — Windows NSIS

| Script / file | Role |
|---------------|------|
| `scripts/build-windows.ps1` | FE → freeze → MinGit → `tauri build --bundles nsis` → rename |
| `scripts/smoke-windows.ps1` | Post-install checklist + health curl |
| `src-tauri/nsis/hooks.nsh` | Force `%LOCALAPPDATA%\FarhadFlowCI\`; document userdata keep |
| `STAFF_INSTALL.md` | Staff install + Defender unsigned note |
| `ACCEPTANCE.md` | Win + Ubuntu VM acceptance (Wave 9) |
| `scripts/scan-secrets-in-payload.sh` | Fail CI/release if `.pem`/PAT-like strings in `resources/` |

```powershell
.\desktop\scripts\build-windows.ps1
.\desktop\scripts\smoke-windows.ps1   # after install on Windows
```

`tauri.conf.json` `bundle.targets`: `["nsis", "deb"]` (shared with Ubuntu Wave 7). Windows build script passes `--bundles nsis`.

### Wave 7 — Ubuntu `.deb`

| Script / file | Role |
|---------------|------|
| `scripts/build-ubuntu.sh` | payload → vendor git → `tauri build --bundles deb` → `desktop/dist/` |
| `scripts/SMOKE-ubuntu.md` | `dpkg -i` / app menu / `dpkg -r` userdata keep |
| `src-tauri/linux/` | desktop template + postinst/postrm (`/opt/farhad-flow-ci` symlinks) |

```bash
SMOKE_ONLY=1 ./desktop/scripts/build-ubuntu.sh
SKIP_PAYLOAD=1 ./desktop/scripts/build-ubuntu.sh
```

### Wave 8 — CI release

| Path | Role |
|------|------|
| [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml) | Matrix `windows-latest` + `ubuntu-latest`; cache Rust + python-standalone; upload artifacts; tag `desktop-v*` → unsigned release |
| `scripts/ci-sidecar-health-smoke.sh` | Linux headless sidecar curl (no WebView); full freeze only |
| [`VERSION_SYNC.md`](VERSION_SYNC.md) | Desktop `0.1.0` SoT (`tauri.conf` / `package.json` / `Cargo.toml`) + `git describe` notes |

**Trigger**

```bash
# Staff PR / iterate (default smoke_only=true — lighter freeze, disk-friendly)
# Actions → Desktop Release → Run workflow → smoke_only checked

# Full staff payload without tagging
# Actions → Desktop Release → smoke_only unchecked

# Publish NSIS + deb as release assets (always full freeze)
git tag -a desktop-v0.1.0 -m "Farhad Flow CI desktop 0.1.0"
git push origin desktop-v0.1.0
```

`SMOKE_ONLY=1` skips full `uv sync` (thin venv). Sidecar health curl runs only when `smoke_only=false` (or on `desktop-v*` tags). CI never requires interactive WebView.

## Related docs

- Repo phase status: [`../STATUS.md`](../STATUS.md)
- Fork notes: [`../FORK.md`](../FORK.md)
- Staff install: [`STAFF_INSTALL.md`](STAFF_INSTALL.md)
- Acceptance: [`ACCEPTANCE.md`](ACCEPTANCE.md)
- Secret scan: `./scripts/scan-secrets-in-payload.sh`
