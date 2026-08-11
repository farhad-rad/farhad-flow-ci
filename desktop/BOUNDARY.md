# Trust boundary — native shell vs webview

Farhad Flow CI desktop = **two worlds**. Secrets and process control live in Rust/native. The webview is an untrusted UI surface that only speaks HTTP to the local sidecar.

## Native (Tauri / Rust) — may hold

- Install / resource / config path resolution
- Sidecar spawn, PATH, `GIT_EXEC_PATH`, env injection from `default.env`
- Port scan (7860–7870), health poll, watchdog, process-tree kill/restart
- Single-instance lock, window/splash/about chrome
- Optional OS keyring access for GitLab PAT (when implemented)
- Logs / apoptosis crumbs / sidecar lease under `{config_dir}`
- Orphan Python reaper (next boot + clear lease on close)

## Webview — may hold

- Baked FE + runtime UI over `http://127.0.0.1:{port}`
- Session cookies / app tokens that the **backend** already issues for auto-login
- User-visible Git SoT wizard UX (clone URL, branch, MR UI) via normal API calls

## Hard rules

1. **PAT never in webview memory via Tauri IPC.** Do not expose invoke commands that return the raw GitLab PAT, paste it into `localStorage`/`sessionStorage`, or echo it in splash IPC. If the wizard needs “PAT is set”, return a boolean / masked status from the backend API — not the secret.
2. **No PAT in frontend bundle or `resources/env`.** Defaults file has auto-login + git flags only.
3. **Sidecar env that contains secrets** is set by the shell / OS keyring path, not by webview → Rust “set secret” round-trips that re-read into JS.
4. **Webview ↔ native IPC** is for window lifecycle, boot stage, reconnect UI — not credential plumbing.
5. **Git remotes / HTTPS** use credentials from the backend credential helper / env known to the Python process, never from JS `fetch` Authorization headers that originated as an IPC dump.

## Threat notes (staff unsigned builds)

- Local attacker with same user can already read `{config_dir}` and attach to localhost; boundary still reduces XSS/webview bug blast radius (stolen UI session ≠ stolen PAT dump via IPC).
- Unsigned Windows builds may trip Defender — document for staff; do not “fix” by lowering isolation.
