# Portable git env — Wave 3

System git **optional**. Bundled git under `resources/git/` is **preferred**. Sidecar (Python/langflow) alone gets PATH / `GIT_EXEC_PATH`; Tauri shell process does not need them for general use.

## Layout

| OS | Tree | PATH prepend (sidecar only) | `GIT_EXEC_PATH` |
|----|------|-----------------------------|-----------------|
| Linux | `bin/git`, `libexec/git-core/` | `{resources}/git/bin` | `{resources}/git/libexec/git-core` |
| Windows MinGit | `cmd/`, `usr/`, `mingw64/` (+ convenience `bin/git.exe`) | `cmd`, `usr/bin`, `mingw64/bin` | `mingw64/libexec/git-core` |

Vendor builds Linux git with `NO_RUST=YesPlease` (git 2.55+ otherwise needs cargo/`libgitcore`).

## Vendor

```bash
# Linux host
./desktop/scripts/vendor-git.sh
./desktop/scripts/verify-bundled-git.sh
```

```powershell
# Windows host / CI
.\desktop\scripts\vendor-git.ps1
```

## Sidecar spawn contract (Wave 4)

See [`sidecar-git-env.env.example`](sidecar-git-env.env.example). Shell must:

1. Resolve absolute `{install_dir}/resources/git`.
2. Prepend platform PATH segments above **only** on the sidecar `Command` env.
3. Set `GIT_EXEC_PATH` to the platform exec-path dir.
4. Fail Stage0 if `bin/git` (Linux) or `cmd/git.exe` (Windows) missing — do not silently rely on system git for staff builds.

## MANIFEST hook (Wave 2)

```bash
./desktop/scripts/manifest-git-entries.sh >> desktop/resources/MANIFEST.sha256
```

Vendor scripts also write `resources/git/MANIFEST.sha256.fragment` and `.vendor-stamp.json`.

## No bundled git

Existing Langflow / Git SoT error catalog already blocks when git is unavailable. Desktop does not invent a parallel message path — Stage0 should refuse boot if the bundle is absent so staff never hit “works on my machine with apt git” drift.
