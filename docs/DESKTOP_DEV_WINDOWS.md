# Desktop / Windows boot (this fork)

Goal: run Langflow OSS UI + local backend from this repo on Windows. Tauri shell is **later**; browser UI is ship path v1.

Pinned: **v1.11.2** (`baseline/v1.11.2`). See [`FORK.md`](../FORK.md).

**Packaging (Phase 6):** start scripts + zip — see [`scripts/windows/README.md`](../scripts/windows/README.md).

## Prerequisites

| Tool | Notes |
|------|--------|
| Git for Windows | On `PATH`. Prefer `core.autocrlf=false` for this repo; flow JSON must stay LF. **Required** for Git-SoT (not bundled in v1 zip). |
| Python | `>=3.10,<3.15` (see root `pyproject.toml`) |
| [uv](https://docs.astral.sh/uv/) | `>=0.4` |
| Node.js | `>=20.19.0` (`src/frontend/package.json` engines) — needed to **build** UI; not needed for end users if zip already contains `src/backend/base/langflow/frontend` |
| npm | Comes with Node |

Upstream `DEVELOPMENT.md` also recommends **Dev Container** or **WSL** for Windows contributors. For Desktop packaging research you may still use native Windows; for day-to-day contrib, WSL/Dev Container is less painful.

## Clone / checkout

```bat
git clone --branch v1.11.2 https://github.com/langflow-ai/langflow.git LangflowDesktopCI
cd LangflowDesktopCI
git remote add upstream https://github.com/langflow-ai/langflow.git
git tag baseline/v1.11.2
```

If tree already exists: stay on `v1.11.2` / `baseline/v1.11.2` until a Desktop branch is created.

## Install + run (Makefile / Make for Windows)

If you have `make` (Git Bash, WSL, or GnuWin):

```bash
uv sync
cd src/frontend && npm install && cd ../..
make run_cli
```

`make run_cli` installs FE/BE deps if needed, builds frontend, then:

```text
uv run langflow run --frontend-path <build> --host ... --port ...
```

Defaults live in the Makefile (`host` / `port`; commonly `7860`).

### Without make (native cmd / PowerShell sketch)

```powershell
uv sync
Set-Location src\frontend
npm install
npm run build
Set-Location ..\..
uv run langflow run --frontend-path src/frontend/build --host 127.0.0.1 --port 7860
```

Exact FE build script name: check `src/frontend/package.json` scripts (`build`).

### Git-SoT desktop start (recommended)

```bat
REM edit LANGFLOW_GIT_FLOWS_DIR inside the script first
scripts\windows\start-langflow-git.bat
```

PowerShell: `pwsh -File scripts\windows\start-langflow-git.ps1`

Sets `LANGFLOW_GIT_*` placeholders, requires Git on `PATH`, runs langflow with built frontend path when present.

## Packaging / zip (Phase 6)

Default: **electron-less start scripts + zip**. Tauri later optional.

| Task | Doc / artifact |
|------|----------------|
| 10.1 Start scripts | `scripts/windows/start-langflow-git.bat` · `.ps1` |
| 10.2 Zip layout | [`scripts/windows/README.md`](../scripts/windows/README.md) — ship FE into `src/backend/base/langflow/frontend` + backend + start scripts |
| 10.3 Git for Windows | **Require on PATH** (not bundled v1) |
| 10.4 First-launch | Git panel Connect wizard — checklist in windows README |
| 10.5 Auto-update | **Manual** zip replace / git pull for v1 |
| 10.6 Code signing | **TBD** (unsigned zip) |
| 10.7 Clean VM smoke | **Follow-up** on Windows VM — not required on Linux packagers |

Build FE for packaging:

```bash
make package_frontend_windows
```

Or on Windows without make: `scripts\windows\build_frontend_only.bat`.

## Local auth defaults (desktop-ish)

- `LANGFLOW_AUTO_LOGIN` defaults **True** (dev bootstrap superuser). Prod Desktop hardens later.
- Env prefix for settings: `LANGFLOW_` (see `lfx.services.settings.base`).

Useful knobs:

```bat
set LANGFLOW_AUTO_LOGIN=true
set LANGFLOW_AUTO_SAVING=true
set LANGFLOW_AUTO_SAVING_INTERVAL=1000
set LANGFLOW_GIT_ENABLED=true
set LANGFLOW_GIT_FLOWS_DIR=C:\path\to\flows_repo
set LANGFLOW_GIT_AUTO_COMMIT=false
REM optional: set LANGFLOW_GIT_PAT=glpat-...
REM legacy / non-git: set LANGFLOW_LOAD_FLOWS_PATH=...
```

When Git-SoT enabled, tree under `LANGFLOW_GIT_FLOWS_DIR` is SoT (`LOAD_FLOWS_PATH` ignored).

## Smoke checklist

1. UI opens in browser.
2. Create empty flow.
3. Save (or wait for autosave).
4. Reload page — flow still listed and opens.

### First-launch Git checklist

1. Git for Windows + uv install.
2. Start with `start-langflow-git.*` (Git-SoT env on).
3. Open **Git** panel → Connect wizard → clone flows template / set PAT.
4. Onboarding checklist in panel (git binary · enabled · flows dir · repo · PAT · production-branch).
5. Save flow → file under `flows\` → restart → same content.

Git-SoT Save→disk + Git panel: Phases 2–4. Packaging docs: Phase 6.

## Git / line endings (important for Git-SoT)

- Do **not** let `core.autocrlf` rewrite `flows/*.json`.
- Flows repo: `.gitattributes` with `flows/*.json text eol=lf` (see `docs/git-sot/`).

## Blocked on this Linux agent machine

Full Windows UI smoke and **10.7 clean VM** were **not** run here. Re-run this doc + [`scripts/windows/README.md`](../scripts/windows/README.md) §10.7 on a Windows box or VM.
