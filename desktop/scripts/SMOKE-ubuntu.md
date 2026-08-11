# Wave 7 — Ubuntu `.deb` smoke notes

Staff packaging smoke for `farhad-flow-ci_X.Y.Z_amd64.deb`. Prefer clean Ubuntu 22.04+ VM with WebKitGTK 4.1.

## Artifact names

| Kind | Pattern | Example (v0.1.0) |
|------|---------|------------------|
| dpkg / bundler filename | `farhad-flow-ci_X.Y.Z_amd64.deb` | `farhad-flow-ci_0.1.0_amd64.deb` |
| Tauri raw filename | `Farhad Flow CI_X.Y.Z_amd64.deb` | spaces from `productName`; `build-ubuntu.sh` renames |
| Staff release channel | `FarhadFlowCI-desktop-vX.Y.Z-ubuntu-amd64.deb` | `FarhadFlowCI-desktop-v0.1.0-ubuntu-amd64.deb` |

Build copies both under `desktop/dist/` after a successful `build-ubuntu.sh`.

Package **name** (control): `farhad-flow-ci` (Cargo.toml / Tauri). No `python3` / `git` Depends — both bundled under `resources/`. Runtime Depends: Tauri defaults (`libwebkit2gtk-4.1-0`, `libgtk-3-0`) only.

Desktop entry: **`Farhad Flow CI.desktop`** (Name = Farhad Flow CI; Zeenome icons from bundle; `StartupWMClass=FarhadFlowCI`).

## Build

```bash
# Full payload + deb
./desktop/scripts/build-ubuntu.sh

# Packaging smoke (lighter venv freeze)
SMOKE_ONLY=1 ./desktop/scripts/build-ubuntu.sh

# Payload already present
SKIP_PAYLOAD=1 ./desktop/scripts/build-ubuntu.sh
```

Or from `desktop/`:

```bash
npx tauri build --bundles deb
```

Expected bundler path:

```text
desktop/src-tauri/target/release/bundle/deb/farhad-flow-ci_0.1.0_amd64.deb
```

## Install smoke (`dpkg -i`)

```bash
sudo dpkg -i farhad-flow-ci_0.1.0_amd64.deb
# if deps missing:
sudo apt-get install -f -y

# menu / CLI
gtk-launch "Farhad Flow CI"   # or open from app menu
# or:
/opt/farhad-flow-ci/FarhadFlowCI
# or:
FarhadFlowCI
```

Checks:

1. App appears as **Farhad Flow CI** with Zeenome icon.
2. Splash → health READY → UI (or Git setup wizard if no flows-repo yet).
3. `/opt/farhad-flow-ci/FarhadFlowCI` and `/opt/farhad-flow-ci/resources` exist (postinst symlinks).
4. Sidecar uses bundled python/git (no system `python3`/`git` required for boot).

## Uninstall — userdata kept

```bash
sudo dpkg -r farhad-flow-ci
# or purge package files only (still does NOT wipe XDG config by our postrm):
sudo dpkg -P farhad-flow-ci
```

**Policy (same as Windows Wave 6):** package remove deletes install tree (`/usr/bin` binary, `/usr/lib/…/resources`, `/opt/farhad-flow-ci` symlinks). It does **not** delete:

- `{config_dir}/flows-repo`
- `{config_dir}/logs`
- keyring / PAT / pubkey material
- anything under `LANGFLOW_CONFIG_DIR` if set

Linux `{config_dir}` default = `directories` / platformdirs for `ci` / `zeenome` / `FarhadFlowCI` (typically under `~/.config/…`). Override: `LANGFLOW_CONFIG_DIR`.

Verify after remove:

```bash
# still present if you used the app before uninstall
ls "${LANGFLOW_CONFIG_DIR:-$HOME/.config}"/*/flows-repo 2>/dev/null || true
test ! -e /opt/farhad-flow-ci && echo "opt prefix gone (ok)"
```

## Disk note

Full release freeze + Rust `target/` needs several GB. On tight disks use `SMOKE_ONLY=1` and/or `CARGO_TARGET_DIR` on a volume with space.
