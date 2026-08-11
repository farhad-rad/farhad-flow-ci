# Git-SoT user + admin manual

For **Langflow Desktop** (this fork) and the **flows-only GitLab** repo.

Ship path: browser UI + local backend. Desktop = git client. **GitLab CI** publishes to prod. Desktop never calls prod API.

Related: [DESKTOP_DEV_WINDOWS.md](../DESKTOP_DEV_WINDOWS.md) · [DESKTOP_DEV_LINUX.md](../DESKTOP_DEV_LINUX.md) · flows template README.

---

## Part A — User manual

### Enable Git-SoT

```bash
export LANGFLOW_GIT_ENABLED=true
export LANGFLOW_GIT_FLOWS_DIR=/path/to/flows-repo
export LANGFLOW_GIT_AUTO_COMMIT=false
```

Windows: see `docs/DESKTOP_DEV_WINDOWS.md`.  
Linux: `./scripts/linux/start-langflow-git.sh /path/to/flows-repo`.

### First connect

1. Boot UI → folder sidebar footer **Git** (or flow canvas Git icon).
2. Connect wizard: GitLab clone URL, local path, PAT (or set env / Settings → **Git Auth**).
3. Confirm non-production branch (panel shows production badge from `.langflow/production-branch`).
4. Onboarding checklist should go green (git present, flows dir, production-branch file, PAT optional until push).

### Daily loop

| Action | What happens |
|--------|----------------|
| Edit + Save | Disk write `flows/<uuid>.json` + `flows.lock` → optional **local auto-commit** (debounced). **Never** auto-push to production. |
| Commit | Manual commit box still available |
| Fetch / Pull | Updates from remote; conflicts → Settings → **Git Conflicts** |
| Push | Enabled only off production branch and with no unresolved conflicts |
| Branch | Switch / create / delete local (not production) |

Shortcuts (panel open): `Ctrl/Cmd+Shift+P` Pull · `Ctrl/Cmd+Shift+U` Push.

### Conflicts

1. Pull/merge leaves conflict → panel banner + **Git Conflicts** page.
2. Per flow: ours / theirs / manual JSON.
3. Resolve → stage path cleared → commit (or auto-commit resolve).
4. Push blocked while any conflict remains.
5. Open-edit blocked on conflicted flow until resolved.

### Leases (multi-user)

- On open-edit: lease under `.langflow/leases/<flow-id>.json`.
- Other user: read-only + banner when lease held.
- Stale leases expire (`LANGFLOW_GIT_LEASE_TTL_SECONDS`, default 300).
- Lease steal = admin/ops action (audited when implemented); do not bypass casually.

### Trash on delete

Deleting a flow moves the prior JSON to `.langflow/trash/` (timestamped) before remove from `flows/` + lock. Restore = manual copy-back from trash (no UI yet).

### Secrets gate

Fail-closed pattern scan runs on commit. Do **not** put live API keys in flow JSON until Phase S strip/inject ships. Prefer placeholders. See `docs/git-sot/secrets/`.

### Errors (short)

| Code / symptom | Meaning |
|----------------|---------|
| Push disabled on prod | `HEAD` == production branch name |
| PAT / auth fail | Keyring empty or bad token — Git Auth or `LANGFLOW_GIT_PAT` |
| Drift modal | DB hash ≠ disk — take disk / keep DB / abort |
| Lease banner | Another editor holds flow |
| Secret scan fail | Commit blocked — strip secrets |

Full catalog: `src/frontend/src/features/git/errorCatalog.ts`.

---

## Part B — Admin GitLab setup

### Create flows project

1. Import / copy from **LangflowFlowsRepoTemplate** (empty `flows/`, `flows.lock`, `.langflow/production-branch`, sample `.gitlab-ci.yml`).
2. Set production branch name in `.langflow/production-branch` (one line, e.g. `production`). Protect that branch on GitLab.
3. Create protected branch + require MR to merge into it.

### CI variables (project settings → CI/CD)

| Variable | Masked | Purpose |
|----------|--------|---------|
| `PROD_API_URL` | no | Headless Langflow API base |
| `PROD_API_KEY` | **yes** | Publish credential |

Desktop does **not** need these. Sample job: template `.gitlab-ci.yml` (verify lock SHAs → stub/real publish).

### PAT for Desktop users

- Scope: `read_repository` + `write_repository` on the flows project (or group).
- Store in OS keyring via Settings → Git Auth, or env `LANGFLOW_GIT_PAT`.
- Rotate: clear in UI + revoke on GitLab + set new.

### Branch / MR policy (recommend)

```text
feature/*  →  (optional main/develop)  →  production  →  CI publish
```

Desktop blocks push when on production. Force-push to production: disable on GitLab.

### Hash contract

Desktop and CI must use the same canonical bytes (sorted keys + LF + SHA-256). See `docs/git-sot/CANONICAL_HASH.md` and template `docs/CANONICAL_HASH.md`.

### App fork vs flows repo

| Repo | Role |
|------|------|
| This tree (`LangflowDesktopCI`) | App fork (UI + backend) |
| Flows GitLab project | SoT JSON only |

Do not store app source in the flows repo.

### Backup / disaster

- Remote git history is primary backup.
- Local `.langflow/trash/` is best-effort undelete for recent Desktop deletes.
- Ops log: `.langflow/git-ops.log` (local diagnostics only).
