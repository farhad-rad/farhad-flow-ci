# Desktop / Linux boot (this fork)

Goal: run Langflow OSS UI + local backend with **Git-SoT** on Linux. Ship path v1 = browser UI (same as Windows). Tauri shell later.

Pinned: **v1.11.2** (`baseline/v1.11.2`). See [`FORK.md`](../FORK.md).  
Windows twin: [`DESKTOP_DEV_WINDOWS.md`](./DESKTOP_DEV_WINDOWS.md).

## Prerequisites

| Tool | Notes |
|------|--------|
| Git | On `PATH`. Prefer `core.autocrlf=input` or `false`; flow JSON must stay **LF**. |
| Python | `>=3.10,<3.15` (root `pyproject.toml`) |
| [uv](https://docs.astral.sh/uv/) | `>=0.4` |
| Node.js | `>=20.19.0` |
| System git | Required by GitPython |
| Optional keyring | `secretstorage` / GNOME Keyring / KWallet — see below |

## Quick start (Git-SoT)

```bash
# From repo root
./scripts/linux/start-langflow-git.sh /path/to/flows-repo
```

Or manually:

```bash
export LANGFLOW_GIT_ENABLED=true
export LANGFLOW_GIT_FLOWS_DIR=/path/to/flows-repo
export LANGFLOW_GIT_AUTO_COMMIT=false
# optional: export LANGFLOW_GIT_PAT=glpat-...

uv sync
cd src/frontend && npm install && npm run build && cd ../..
uv run langflow run --frontend-path src/frontend/build --host 127.0.0.1 --port 7860
```

Clone a flows repo from the template first (see sibling `LangflowFlowsRepoTemplate` / your GitLab forks).

## Paths

| Concern | Linux note |
|---------|------------|
| Flows root | Absolute path preferred. `~` expanded by settings. |
| Spaces / unicode | Supported; quote shells. Jail still under `LANGFLOW_GIT_FLOWS_DIR`. |
| Long paths | POSIX has no Windows `\\?\` prefix; `win_long_path()` is no-op on Linux. |
| Atomic write | Same `.staging` + `os.replace` as Windows (same filesystem). |
| FS events / debounce | Auto-commit debounce is timer-based (`LANGFLOW_GIT_AUTO_COMMIT_DEBOUNCE_MS`, default 1500). No inotify dependency for SoT. |
| Line endings | Enforce LF on `flows/*.json` (flows repo `.gitattributes`). |

## Keyring (PAT storage)

Backend: `keyring` service name `langflow-desktop-git`, username `gitlab-pat`.

| Desktop env | Typical backend |
|-------------|-----------------|
| GNOME | Secret Service (`libsecret` / GNOME Keyring) |
| KDE | KWallet |
| Headless / CI / SSH | Often **no** unlockable keyring → use env |

Fallback (never written by Desktop into files):

```bash
export LANGFLOW_GIT_PAT=glpat-...
# also accepted: LANGFLOW_GIT_TOKEN, GITLAB_TOKEN, GIT_TOKEN
```

Install helper packages if UI store fails:

```bash
# Debian/Ubuntu example
sudo apt install gnome-keyring libsecret-1-0
uv pip install keyring secretstorage   # into project env as needed
```

Check: Settings → **Git Auth** shows `source=keyring` or `env`.

## Lease / conflict parity

**Same backend as Windows.** No Linux-specific lease or conflict code paths:

- Leases: `.langflow/leases/<flow-id>.json`
- Conflicts: `.langflow/conflicts/`
- Prod guard: `.langflow/production-branch`
- APIs: `/api/v1/git/*`

Parity test = run the same Git panel flows (clone → edit → auto-commit → pull conflict → resolve → push non-prod) on Linux.

## Smoke checklist

1. UI opens at `http://127.0.0.1:7860`.
2. Git panel → connect / status shows branch.
3. Create/edit flow → Save → file under `$LANGFLOW_GIT_FLOWS_DIR/flows/<id>.json`.
4. Save does **not** auto-commit (`LANGFLOW_GIT_AUTO_COMMIT=false`). Commit from History.
5. Push blocked on production branch.
6. Scripts (no full pytest):

```bash
PYTHONPATH=src/backend/base python scripts/git-sot/verify_atomic_write.py
PYTHONPATH=src/backend/base python scripts/git-sot/verify_git_engine.py
```

## Blocked / best-effort on agents

Full two-way sync against a real GitLab may need network + PAT. Script smokes are enough for local store/engine sanity.
