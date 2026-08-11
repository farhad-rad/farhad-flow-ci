# Wave 5 — Branding + desktop UX polish

Caveman doc. Shell chrome only. Plan Wave 5 tasks 46–51.

## 46–48 — Title / icon / about

| Surface | Value |
|---------|--------|
| Window title | `Farhad Flow CI` (`tauri.conf.json` → `app.windows[0].title`) |
| Product / binary | `productName` Farhad Flow CI · `mainBinaryName` FarhadFlowCI · id `ci.zeenome.farhadflow` |
| Taskbar / dock icon | Zeenome mark set under `src-tauri/icons/` (`icon.ico` / png / icns) |
| Splash | `splash/index.html` — ZeenomeLogo + version; Wave 4 `apply(BootSnapshot)` + Restart backend preserved |
| About | Help → **About Farhad Flow CI** → `splash/about.html` webview (`about` label); same logo + version |

Rust: `src-tauri/src/about.rs` — menu + `open_about_window`. Closing about does **not** shut down sidecar (only `main` close / app Exit).

## 49 — Visible “Langflow” on first paint

Splash + about copy = **Farhad Flow CI** / **Zeenome** only. No Langflow chrome on boot HTML.

Deep FE i18n / header already FarhadFlowCI + Zeenome (out of Wave 5 splash scope).

## 50 — Store / cloud upsell (no FE rewrite)

| Lever | State | Effect |
|-------|--------|--------|
| FE `ENABLE_LANGFLOW_STORE` | **`false`** in `src/frontend/src/customization/feature-flags.ts` | `storeStore.hasStore=false`; `StoreGuard` blocks `/store`; sidebar store entry omitted |
| `LANGFLOW_STORE_URL` | **unset** in `resources/env/default.env` | No store API URL baked for desktop sidecar |
| Social / get-started | Already nulled via customization (`custom-langflow-counts`, `custom-get-started-progress`) | No Discord/GitHub upsell strip |

No massive FE rewrite. Staff IDE keeps store off at compile flag + env omission. Do **not** flip `ENABLE_LANGFLOW_STORE` to true for desktop builds.

## 51 — Git setup gate (first-run)

**Verified mounted — no code change.**

- `src/frontend/src/pages/AppAuthenticatedPage/index.tsx` wraps authenticated tree in `<GitSetupGate>…</GitSetupGate>`
- `GitSetupGate` (`src/frontend/src/features/git/GitSetupGate.tsx`) polls `GET /api/v1/git/setup/status`; until `ready`, shows `GitSetupWizard` (fail-closed on error)
- Desktop does not bypass gate; `LANGFLOW_GIT_FLOWS_DIR` unset → `{config_dir}/flows-repo` → wizard still first-run when missing

## Files (Wave 5)

- `desktop/splash/index.html`, `desktop/splash/about.html`
- `desktop/src-tauri/src/about.rs`, `lib.rs`, `capabilities/default.json`
- `desktop/resources/env/default.env`
- this file
