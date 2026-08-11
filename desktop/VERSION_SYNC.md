# Desktop version sync (Wave 8)

Staff desktop shell version is **independent** of the Langflow/app PyPI line (`1.11.x`).
Packaging / installer version SoT for Farhad Flow CI desktop:

| File | Field | Example |
|------|--------|---------|
| `desktop/src-tauri/tauri.conf.json` | `version` | `0.1.0` |
| `desktop/package.json` | `version` | `0.1.0` |
| `desktop/src-tauri/Cargo.toml` | `package.version` | `0.1.0` |

Keep these three equal. CI (`desktop-release.yml` resolve job) fails on mismatch.

## Tags

Release tags: `desktop-vX.Y.Z` (example `desktop-v0.1.0`).

Tag suffix **must** match `tauri.conf.json` version (`desktop-v` + version).

```bash
# After bumping the three files above:
git tag -a desktop-v0.1.0 -m "Farhad Flow CI desktop 0.1.0"
git push origin desktop-v0.1.0
```

## git describe

CI logs `git describe --tags --always --dirty` for triage. Artifact **filenames** use the package version from `tauri.conf.json`, not a dirty describe string.

```
FarhadFlowCI_0.1.0_x64-setup.exe
FarhadFlowCI-desktop-v0.1.0-windows-nsis.exe
farhad-flow-ci_0.1.0_amd64.deb
FarhadFlowCI-desktop-v0.1.0-ubuntu-amd64.deb
```

## Bump checklist

1. Edit `tauri.conf.json` / `package.json` / `Cargo.toml` to the same `X.Y.Z`.
2. Optionally note app/backend pin in release notes (e.g. frozen against `1.11.x`) — do **not** force desktop version == app version.
3. Tag `desktop-vX.Y.Z` → GHA full freeze + unsigned NSIS + deb as release assets.
