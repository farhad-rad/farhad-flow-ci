# Bundled portable git

Filled by:

- Linux: `desktop/scripts/vendor-git.sh` → `bin/git` + `libexec/git-core/`
- Windows: `desktop/scripts/vendor-git.ps1` → MinGit (`cmd/`, `usr/`, `mingw64/`)

Env contract: `desktop/scripts/git-env.md`. System git optional; bundled preferred.

Wave 2: `desktop/scripts/manifest-git-entries.sh` appends critical hashes into `resources/MANIFEST.sha256`.
