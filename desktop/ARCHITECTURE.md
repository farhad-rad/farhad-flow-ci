# Desktop architecture — Farhad Flow CI

Thin Tauri 2 shell + frozen Python sidecar + baked frontend + portable git. Git clone/init/PAT stay **runtime** (wizard). No flows repo in the installer.

## Layout at runtime

```
{install_dir}/
  FarhadFlowCI(.exe)          # Tauri shell
  resources/
    python/                   # python-build-standalone
    venv/                     # frozen site-packages / venv
    frontend/                 # baked static UI
    git/                      # MinGit (Win) or vendored git (Linux)
    env/default.env           # sidecar defaults
```

User data (outside install):

```
{config_dir}/                 # platformdirs; override LANGFLOW_CONFIG_DIR
  flows-repo/                 # Git SoT working tree (clone at first run)
  logs/sidecar.log
  … keyring / pubkey / crumbs …
```

### Install paths

| Platform | `{install_dir}` |
|----------|-----------------|
| Windows | NSIS wizard — **selectable** (per-user / Program Files / other drive) |
| Ubuntu | `/opt/farhad-flow-ci/` |

`{config_dir}` defaults:
- Windows: `%APPDATA%\zeenome\FarhadFlowCI\`
- Ubuntu/Linux: `~/app_data/zeenome/farhad-flow-ci/`
- Override: `LANGFLOW_CONFIG_DIR`

Default flows path when `LANGFLOW_GIT_FLOWS_DIR` unset: `{config_dir}/flows-repo`.

## Boot FSM

```
Stage0_Paths → Stage1_Spawn → Stage2_Ready → WebviewOpen → Running
                  ↑                │
                  └── watchdog ────┘ (heartbeat miss → kill process tree → respawn)
```

| Stage | Shell does |
|-------|------------|
| **Stage0_Paths** | Resolve install/resources; **orphan reaper** (Wave 10 lease); verify python + frontend + git; create `{config_dir}`; load env |
| **Stage1_Spawn** | Pick listen port; spawn sidecar with PATH/`GIT_EXEC_PATH`; log to `{config_dir}/logs/sidecar.log`; write sidecar lease |
| **Stage2_Ready** | Poll health until READY (timeout → splash error) |
| **WebviewOpen** | Navigate to `http://127.0.0.1:{port}`; hide splash |
| **Running** | Heartbeat; soft reconnect overlay on miss; hard reset = kill tree + Stage1 |
| **Close / Exit** | Kill process tree + clear sidecar lease (orphan reaper covers unclean kill -9) |

Dev escape hatch: `FARHAD_FLOW_CI_DEV=1` may attach to an already-running backend (staff debug) without breaking prod spawn.

## Port selection (7860–7870)

Default bind: `127.0.0.1:7860`.

If the port is busy, shell scans **`7860` through `7870` inclusive**, uses the first free port for that session, and points the webview at it. Persist chosen port for the session only (not a permanent user preference unless later waves add it).

Sidecar argv shape (Wave 2+):

```text
{resources/python}/…/python -m langflow run --host 127.0.0.1 --port {port} --frontend-path {resources/frontend}
```

## Env contract

Defaults ship in `resources/env/default.env`. Shell injects/overrides at spawn:

| Variable | Default intent |
|----------|----------------|
| `LANGFLOW_AUTO_LOGIN` | `true` (UI open; real auth = GitLab PAT) |
| `LANGFLOW_GIT_ENABLED` | `true` |
| `LANGFLOW_GIT_AUTO_COMMIT` | `false` (forced off — manual commit only) |
| `LANGFLOW_HOST` / host flag | `127.0.0.1` |
| `LANGFLOW_PORT` / port flag | chosen port in 7860–7870 |
| `LANGFLOW_CONFIG_DIR` | Win `%APPDATA%\zeenome\FarhadFlowCI\`; Linux `~/app_data/zeenome/farhad-flow-ci/` |
| `LANGFLOW_GIT_FLOWS_DIR` | unset → `{config_dir}/flows-repo` |
| `LANGFLOW_STORE_URL` | **unset** (Wave 5 — store off; FE `ENABLE_LANGFLOW_STORE=false`) |
| `PYTHONNOUSERSITE` | `1` |
| `VIRTUAL_ENV` | `{resources}/venv` |
| `PYTHONPATH` | venv `site-packages` (+ inherit) |
| `PATH` | git + python + venv prepend (+ inherit) |
| `GIT_EXEC_PATH` | bundled git-core |
| `LD_LIBRARY_PATH` | Linux only — `{resources}/python/lib` (+ inherit) |

Branding / about / GitSetupGate: [`BRANDING.md`](BRANDING.md).

Bundled git: shell prepends `resources/git/…` to **sidecar** PATH and sets `GIT_EXEC_PATH` as needed. System git is optional; bundled preferred. Full contract: [`scripts/git-env.md`](scripts/git-env.md) + [`scripts/sidecar-git-env.env.example`](scripts/sidecar-git-env.env.example).

| Sidecar env (only) | Linux | Windows MinGit |
|--------------------|-------|----------------|
| PATH prepend | `resources/git/bin` | `resources/git/cmd`, `usr/bin`, `mingw64/bin` |
| `GIT_EXEC_PATH` | `resources/git/libexec/git-core` | `resources/git/mingw64/libexec/git-core` |

Vendor: `scripts/vendor-git.sh` (Linux) / `scripts/vendor-git.ps1` (Windows). Verify: `scripts/verify-bundled-git.sh`. MANIFEST hook: `scripts/manifest-git-entries.sh`.

## What is NOT bundled

- **No flows Git clone** in the installer or `resources/`
- No GitLab PAT / secrets material in the payload
- No system Python / uv / Node required for end users
- No auto-updater channel (manual reinstall)

## Release naming

```
FarhadFlowCI_X.Y.Z_x64-setup.exe                 # Windows NSIS canonical (build-windows.ps1)
FarhadFlowCI-desktop-vX.Y.Z-windows-nsis.exe     # channel alias
farhad-flow-ci_X.Y.Z_amd64.deb                   # Ubuntu dpkg / Tauri bundler
FarhadFlowCI-desktop-vX.Y.Z-ubuntu-amd64.deb     # Ubuntu staff channel alias
```

Windows packaging: `installMode=both` — staff pick install dir (Program Files when elevated, or another path). Uninstall deletes install dir only — `{config_dir}/flows-repo` retained (see `STAFF_INSTALL.md`).

Ubuntu packaging: package `farhad-flow-ci`; desktop **Farhad Flow CI.desktop** (Zeenome icons); postinst symlinks `/opt/farhad-flow-ci/` → Tauri `/usr` layout. `dpkg -r` keeps userdata (see `scripts/SMOKE-ubuntu.md`).

**Known artifact size:** Ubuntu `.deb` staff build ≈ **1.6 GiB** (`farhad-flow-ci_0.1.0_amd64.deb`). Cold start often tens of seconds (see `STAFF_INSTALL.md`).

## Trust / process boundary

See [`BOUNDARY.md`](BOUNDARY.md). PAT and native spawn stay on the Rust side; webview talks HTTP to localhost only.
