# `resources/` — bundled payload schema

Filled by Wave 2–3 build scripts. Empty placeholders (`.gitkeep`) are intentional in Wave 0.

| Directory | Contents (when built) |
|-----------|------------------------|
| `python/` | **python-build-standalone** extract for the target OS (`versions.lock.json`) |
| `venv/` | Frozen virtualenv / site-packages built against that interpreter |
| `frontend/` | Production static UI from `Makefile.frontend` / `build_frontend` |
| `git/` | Windows **MinGit** or Linux vendored git (`bin` + `libexec`; see `scripts/git-env.md`). System git optional; bundled preferred. |
| `env/` | Sidecar defaults; see `env/default.env` |

## Rules

- Do not commit large binaries here in Wave 0; CI downloads and stages them at package time.
- Shell verifies critical binaries on boot (Wave 2: `MANIFEST.sha256`).
- **No flows repository** under `resources/` — clone goes to `{config_dir}/flows-repo`.

## Relative layout beside the executable

```
resources/python/…/python
resources/venv/…
resources/frontend/index.html + assets
resources/git/bin/git   (and Win cmd/)
resources/env/default.env
```
