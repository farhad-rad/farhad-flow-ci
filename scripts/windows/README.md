# Windows packaging — Langflow Desktop Git-SoT (Phase 6 / Wave 10)

**Default packager:** start scripts + zip (no installer). **Tauri** thin shell is optional later.

This host may be Linux; scripts/docs below are the Windows artifacts. **Clean Windows VM smoke (10.7) is a documented follow-up** — not required to pass from this agent.

Canonical env knobs: `LANGFLOW_GIT_ENABLED`, `LANGFLOW_GIT_FLOWS_DIR`, `LANGFLOW_GIT_AUTO_COMMIT`, optional `LANGFLOW_GIT_PAT` / keyring via Git Auth UI.

---

## Prerequisites (end-user machine)

| Tool | Why |
|------|-----|
| [Git for Windows](https://git-scm.com/download/win) | Required on `PATH`. Desktop git engine uses system `git` (GitPython). Prefer `git config --global core.autocrlf false` for flows JSON (LF / canonical hash). |
| Python `>=3.10,<3.15` | See root `pyproject.toml` |
| [uv](https://docs.astral.sh/uv/) `>=0.4` | Backend deps + `uv run langflow` |
| Node.js `>=20.19` + npm | Only needed to **build** frontend for a zip; end users consuming a prebuilt zip do not need Node if `src/backend/base/langflow/frontend` already contains the build |

**Git is required, not bundled** in v1 zip (10.3). Installer/embed later optional.

---

## Start scripts (10.1)

| Script | Role |
|--------|------|
| [`start-langflow-git.bat`](./start-langflow-git.bat) | cmd: set Git-SoT env placeholders, require `git` + `uv`, run langflow |
| [`start-langflow-git.ps1`](./start-langflow-git.ps1) | PowerShell equivalent |

Edit placeholders in the script (or set machine/user env) before first run:

```bat
set LANGFLOW_GIT_ENABLED=true
set LANGFLOW_GIT_FLOWS_DIR=C:\langflow-flows
set LANGFLOW_GIT_AUTO_COMMIT=false
REM optional: set LANGFLOW_GIT_PAT=glpat-...
```

From repo root (or double-click after clone/extract):

```bat
scripts\windows\start-langflow-git.bat
```

```powershell
pwsh -File scripts\windows\start-langflow-git.ps1
```

Dev build path (rebuild FE then run): existing [`build_and_run.bat`](./build_and_run.bat) / [`.ps1`](./build_and_run.ps1). For packaging prep only: [`build_frontend_only.bat`](./build_frontend_only.bat) or `make package_frontend_windows`.

---

## Zip distribution layout (10.2)

Ship a **source-ish runtime zip** (v1), not an MSI. After extract, user runs `uv sync` once (or you pre-sync a venv into the zip — heavier; not default).

Recommended tree inside `LangflowDesktop-<version>-win.zip`:

```text
LangflowDesktopCI/                 # or LangflowDesktop-<ver>/
  FORK.md
  pyproject.toml
  uv.lock
  README.md                        # optional thin pointer here
  scripts/
    windows/
      README.md                    # this file
      start-langflow-git.bat
      start-langflow-git.ps1
      build_frontend_only.bat      # packagers / rebuilders only
      build_frontend_only.ps1
      build_and_run.bat
      build_and_run.ps1
  src/
    backend/base/langflow/frontend/   # MUST contain built static UI (index.html, assets/)
    backend/base/...                  # Python package tree as in git
    frontend/                         # optional in zip if frontend/ already copied above
    lfx/...
  docs/
    DESKTOP_DEV_WINDOWS.md
    git-sot/                          # ADRs + STATUS (operator docs)
```

**Must ship from frontend build:** contents of `src/frontend/build/` (or `dist/`) copied into `src/backend/base/langflow/frontend/` (same as `make build_frontend` / `build_frontend_only.*`).

**Must ship from backend:** Python sources + `pyproject.toml` / `uv.lock` so `uv sync` + `uv run langflow run` works. Do **not** ship secrets, `.env` with live PATs, or customer `flows/*.json`.

**Do not require** Node in the end-user zip if FE is prebuilt into `langflow/frontend`.

Packager checklist:

1. `git checkout` release tag / Desktop branch.
2. `uv sync` (verify on Windows).
3. `make package_frontend_windows` **or** `scripts\windows\build_frontend_only.bat`.
4. Confirm `src\backend\base\langflow\frontend\index.html` exists.
5. Zip tree above; exclude `src/frontend/node_modules`, `.venv` (unless deliberately bundling), `__pycache__`, `.git` (optional — include `.git` only if you want in-place updates via git pull).
6. Publish zip + short release notes (manual update path, below).

---

## Flows template + first launch (10.4)

Flows live in a **separate GitLab flows-only repo** (not this app zip). Typical skeleton:

```text
flows/                     # flow JSON files
flows.lock
.langflow/production-branch
.gitattributes             # flows/*.json text eol=lf
.gitlab-ci.yml             # publish contract (CI only)
README.md
```

### First-launch checklist (links Git panel wizard)

1. Install Git for Windows + uv + Python (table above).
2. Extract zip → `cd` into root → `uv sync`.
3. Edit `LANGFLOW_GIT_FLOWS_DIR` in `start-langflow-git.bat` / `.ps1` (or set env) — empty folder OK if you will clone via UI.
4. Run `start-langflow-git.bat` → open browser (`http://127.0.0.1:7860` by default).
5. Open **Git** panel (folder sidebar footer **Git**, or flow page Git icon, or health banner **Open Git**).
6. Use **Connect / clone wizard**: GitLab flows-repo URL, destination path (= `LANGFLOW_GIT_FLOWS_DIR`), PAT (or Settings → **Git Auth**).
7. Confirm onboarding checklist ticks: system git · `LANGFLOW_GIT_ENABLED` · flows dir · repo is git · PAT · `production-branch` file.
8. Stay off production branch for day-to-day edits; Save → auto-commit (no auto-push to prod).
9. Push only via Git panel on non-prod branches; GitLab CI publishes from prod branch.

See also in-app `OnboardingChecklist` and [`docs/DESKTOP_DEV_WINDOWS.md`](../../docs/DESKTOP_DEV_WINDOWS.md).

---

## Auto-update (10.5) — manual OK for v1

No auto-updater in v1.

- Operators download a newer zip (or `git pull` / rebase Desktop fork) and replace the extract.
- Re-run `uv sync` if lockfile changed; re-run frontend package step if UI changed.
- Flows data stays in the separate flows git repo (`LANGFLOW_GIT_FLOWS_DIR`) — not inside the app zip.
- Future: optional Tauri / installer channel + signed updates.

---

## Code signing (10.6) — TBD

**TBD.** v1 zip is unsigned. SmartScreen / AV may warn on downloaded zips and scripts.

When an installer or Tauri binary ships: pick Authenticode cert, CI sign step, and timestamp server — track as release gate before wide enterprise rollout.

---

## Clean Windows VM smoke (10.7) — follow-up

**Not run on Linux packaging hosts.** On a clean Windows VM:

1. Fresh user profile; install only Git for Windows, Python, uv (and Node only if rebuilding FE).
2. Extract zip → `uv sync` → `start-langflow-git.bat`.
3. Clone flows template via Git panel wizard.
4. Create flow → Save → file under `flows\` → restart → same flow.
5. Commit / push non-prod; confirm push blocked on production branch.
6. Note High-DPI, path-with-spaces, AV rename retries (Phase 4 items 8.5–8.6).

Mark pass/fail in [`docs/git-sot/STATUS.md`](../../docs/git-sot/STATUS.md) when done.

---

## Related

- Dev runbook: [`docs/DESKTOP_DEV_WINDOWS.md`](../../docs/DESKTOP_DEV_WINDOWS.md)
- Git UI status: [`docs/git-sot/STATUS.md`](../../docs/git-sot/STATUS.md)
- Makefile: `make package_frontend_windows`
