# Staff install — Farhad Flow CI (desktop)

Staff-only, **unsigned** builds. Audience = trusted staff machines / LAN. No auto-update — reinstall a newer artifact (see Manual update).

Canonical guide lives here (`desktop/STAFF_INSTALL.md`). Related: [`ACCEPTANCE.md`](ACCEPTANCE.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`BOUNDARY.md`](BOUNDARY.md).

---

## Security (read first)

| Fact | Implication |
|------|-------------|
| Builds are **not code-signed** | SmartScreen / Defender warnings expected on Windows |
| `LANGFLOW_AUTO_LOGIN=true` | Local UI has no staff password gate |
| Real auth = **GitLab PAT** | PAT in OS keyring or `LANGFLOW_GIT_PAT` — never in installer payload |

**Trust model:** staff-controlled machine + trusted release channel. Do **not** ship these builds to untrusted endpoints or shared kiosks. Local user can already reach `127.0.0.1` and `{config_dir}` — AUTO_LOGIN does not replace PAT for Git push/MR.

---

## Artifact names

| Role | Windows | Ubuntu |
|------|---------|--------|
| Canonical | `FarhadFlowCI_X.Y.Z_x64-setup.exe` | `farhad-flow-ci_X.Y.Z_amd64.deb` |
| Release-channel alias | `FarhadFlowCI-desktop-vX.Y.Z-windows-nsis.exe` | `FarhadFlowCI-desktop-vX.Y.Z-ubuntu-amd64.deb` |
| Tauri raw (before rename) | `Farhad Flow CI_X.Y.Z_x64-setup.exe` (spaces) | `Farhad Flow CI_X.Y.Z_amd64.deb` (spaces) |

Build scripts copy/rename into `desktop/dist/`.

---

## Windows (NSIS)

### Install

1. Run the setup `.exe`. Per-user install needs **no admin**; Program Files / protected paths need elevate.
2. Install dir: **selectable** in the NSIS wizard (per-user default, Program Files when elevated, or another drive/path).
3. Start Menu shortcut under **Farhad Flow CI**.
4. Finish page: optional **Desktop** shortcut (checkbox).
5. Launch **Farhad Flow CI** → splash → backend READY → UI.
6. First run: Git SoT wizard (clone/init). PAT stays outside webview (`BOUNDARY.md`).

### Uninstall

Windows Apps & features / NSIS uninstaller.

- Removes **install dir only** (whatever path was chosen at install).
- Does **not** wipe `{config_dir}/flows-repo` (or PAT / age keys in keyring).
- Default config dir: `%APPDATA%\zeenome\FarhadFlowCI\`. Override: `LANGFLOW_CONFIG_DIR`.
- To delete flows: remove `{config_dir}\flows-repo` manually after uninstall.

### Windows Defender / SmartScreen (unsigned)

Expect SmartScreen “unknown publisher” → **More info** → **Run anyway** (staff policy). Defender may quarantine first run.

Staff actions:

1. Confirm hash/source from your release channel.
2. Allow / restore if quarantined.
3. Prefer enterprise allowlist by hash when IT can pin builds.

Do **not** disable Defender globally.

### Smoke after install

```powershell
.\desktop\scripts\smoke-windows.ps1
```

---

## Ubuntu (`.deb`)

### Install

```bash
sudo dpkg -i farhad-flow-ci_X.Y.Z_amd64.deb
# if deps missing:
sudo apt-get install -f -y
```

- Package: `farhad-flow-ci`. Desktop entry **Farhad Flow CI** (Zeenome icon).
- Install prefix symlink: `/opt/farhad-flow-ci/` (binary + `resources` → Tauri `/usr` layout).
- Depends: WebKitGTK / GTK only — **no** `python3` / `git` packages (bundled).
- Launch from app menu, `gtk-launch "Farhad Flow CI"`, or `/opt/farhad-flow-ci/FarhadFlowCI`.

### Uninstall

```bash
sudo dpkg -r farhad-flow-ci
```

Removes install tree only — **does not** wipe `{config_dir}/flows-repo`. Linux config dir: `~/app_data/zeenome/farhad-flow-ci/`. Override: `LANGFLOW_CONFIG_DIR`.

Full packaging smoke: [`scripts/SMOKE-ubuntu.md`](scripts/SMOKE-ubuntu.md).

---

## GitLab PAT scopes + first clone

### Required scopes

Create a **project** or **group** access token / personal access token with at least:

| Scope | Why |
|-------|-----|
| `read_repository` | Clone / fetch / pull / MR list |
| `write_repository` | Push, branch create, MR source updates |

Optional if your GitLab version exposes them and staff use API-heavy MR flows: `read_api` / `api` — prefer least privilege; repo scopes above are the floor (see `docs/git-sot/USER_MANUAL.md`).

Token must reach the **flows-only** GitLab project (not this app fork).

### Store PAT

1. Preferred: Settings → **Git Auth** → save to OS keyring (`langflow-desktop-git` / `gitlab-pat`).
2. Fallback (headless / keyring fail):

```bash
# Linux / mac-style shell
export LANGFLOW_GIT_PAT=glpat-...

# Windows PowerShell (session)
$env:LANGFLOW_GIT_PAT = "glpat-..."
```

### First clone (wizard)

1. Launch app → Git setup gate when `{config_dir}/flows-repo` missing.
2. Paste clone URL (HTTPS) for the flows project.
3. Confirm local path (default `{config_dir}/flows-repo`) or override via wizard / `LANGFLOW_GIT_FLOWS_DIR`.
4. Enter PAT (or rely on keyring / env already set).
5. Clone completes → History / Branches / MRs available.

Init-empty path also supported when staff start a new remote — same wizard.

---

## Troubleshooting

### Port busy (7860–7870)

Shell scans **7860 through 7870** and binds the first free port for the session. If **all** busy:

1. Quit other Farhad Flow CI / langflow instances.
2. Check: `ss -ltnp | grep -E '786[0-9]|7870'` (Linux) or `netstat -ano | findstr 786` (Windows).
3. Next boot runs **orphan reaper** — unclean prior exit may leave Python; relaunch once after crash.
4. Still stuck: reboot or kill leftover `python … -m langflow` using bundled path under `resources/python`.

### Sidecar log path

| OS | Default log |
|----|-------------|
| Both | `{config_dir}/logs/sidecar.log` |
| Apoptosis crumb | `{config_dir}/logs/apoptosis-crumb.json` |
| Sidecar lease (reaper) | `{config_dir}/logs/sidecar-lease.json` |

Windows example: `%APPDATA%\zeenome\FarhadFlowCI\logs\sidecar.log`  
Linux example: `~/app_data/zeenome/farhad-flow-ci/logs/sidecar.log` (override with `LANGFLOW_CONFIG_DIR`).

Splash crash UI surfaces last crumb lines + **Restart backend**.

### Bundled git verify

Installer ships git under `{install_dir}/resources/git/`. System git optional.

```bash
# After install — Linux
/opt/farhad-flow-ci/resources/git/bin/git --version
GIT_EXEC_PATH=/opt/farhad-flow-ci/resources/git/libexec/git-core \
  /opt/farhad-flow-ci/resources/git/bin/git --exec-path
```

```powershell
# Windows
& "$env:LOCALAPPDATA\FarhadFlowCI\resources\git\cmd\git.exe" --version
```

Build-time check: `desktop/scripts/verify-bundled-git.sh`. Stage0 refuses boot if bundled git missing.

### Keyring failures → `LANGFLOW_GIT_PAT`

| Symptom | Fix |
|---------|-----|
| Git Auth save fails / `source` never keyring | Unlock GNOME Keyring / Windows Credential Manager; or skip keyring |
| Headless / SSH / CI | Set `LANGFLOW_GIT_PAT` in the user environment before launch |
| Push 401 | Rotate token; clear bad keyring entry in Settings → Git Auth; set env |

See `docs/DESKTOP_DEV_LINUX.md` / `docs/DESKTOP_DEV_WINDOWS.md` for keyring package notes.

---

## Manual update SOP

No in-app updater. Staff update = new artifact.

### Recommended

1. Quit Farhad Flow CI (confirm no splash/backend).
2. **Windows:** run new `FarhadFlowCI_*_x64-setup.exe` over existing install (or uninstall then install).  
   **Ubuntu:** `sudo dpkg -i farhad-flow-ci_NEW_amd64.deb` (replaces package files).
3. Launch → splash → UI. `{config_dir}/flows-repo`, PAT, age keys **kept**.
4. Optional: smoke health (`smoke-windows.ps1` / curl `http://127.0.0.1:7860/api/v1/git/health` — port may differ).

### Uninstall then reinstall

Same userdata retention policy: uninstall removes **install dir only**. Safe when over-install fails (locked files). After reinstall, wizard skipped if `flows-repo` still present.

### Do not

- Delete `{config_dir}` unless intentionally wiping SoT + logs.
- Expect auto-migration prompts — version skew is “reinstall + same config dir”.

---

## Size + cold start (known artifacts)

| Artifact | Known size (v0.1.0 staff build) | Notes |
|----------|----------------------------------|-------|
| Ubuntu `.deb` | **~1.6 GiB** | Measured `desktop/dist/farhad-flow-ci_0.1.0_amd64.deb` |
| Windows NSIS | Same order of magnitude | Frozen python + venv + FE + MinGit |

**Cold start (staff expectation):**

- First launch after install: splash while sidecar imports — often **tens of seconds** (disk / AV scan on Windows).
- Later launches: typically faster; still not “instant” — frozen venv is large.
- If splash exceeds ~2 minutes: check `sidecar.log`, Defender scanning, disk, port conflict.

Trim work (Wave 2 excludes) already drops tests/`__pycache__`; further cuts need dep audit — do not strip blindly.

---

## Payload secret scan (release hygiene)

Before publishing artifacts, scan `desktop/resources`:

```bash
./desktop/scripts/scan-secrets-in-payload.sh
# or:
./desktop/scripts/scan-secrets-in-payload.sh /path/to/resources
```

Fails on `.pem` files and PAT-like strings. Allowlist path for known public keys: `desktop/scripts/scan-secrets-allowlist.txt` (empty by default — age keys belong in keyring / `.langflow/keys.age`, not payload).

---

## Build (staff / CI machines)

```powershell
# Windows — from repo root (checks/installs Rust, MSVC, Node, Git, WebView2 if missing)
.\desktop\scripts\build-windows.ps1
# CI / already-provisioned host (fail if deps missing, no winget):
.\desktop\scripts\build-windows.ps1 -SkipDepInstall
```

```bash
# Ubuntu
./desktop/scripts/build-ubuntu.sh
```

Prereqs: Rust, Node 22.12+, network for python-build-standalone + git vendor pins (`versions.lock.json`).

---

## Related

- [`ACCEPTANCE.md`](ACCEPTANCE.md) — Win + Ubuntu VM checklist (Wave 9 items)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — paths, boot FSM, what is not bundled
- [`BOUNDARY.md`](BOUNDARY.md) — PAT / native vs webview
- [`README.md`](README.md) — desktop map + payload scripts
- [`scripts/SMOKE-ubuntu.md`](scripts/SMOKE-ubuntu.md) — deb smoke
