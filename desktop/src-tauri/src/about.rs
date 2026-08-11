//! About window — Farhad Flow CI / Zeenome (Wave 5).
//! No app menu bar (Help was removed to keep chrome short).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const ABOUT_WINDOW_LABEL: &str = "about";

/// Small non-resizable about dialog: ZeenomeLogo + version from package / tauri.conf.
#[allow(dead_code)]
pub fn open_about_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(ABOUT_WINDOW_LABEL) {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        push_about_version(app);
        return Ok(());
    }

    let version = app_version(app);
    let version_json =
        serde_json::to_string(&version).unwrap_or_else(|_| "\"0.0.0\"".into());
    let init = format!(
        "window.__FARHAD_FLOW_CI_VERSION__ = {version_json};"
    );

    WebviewWindowBuilder::new(
        app,
        ABOUT_WINDOW_LABEL,
        WebviewUrl::App("about.html".into()),
    )
    .title("About Farhad Flow CI")
    .inner_size(420.0, 340.0)
    .min_inner_size(360.0, 280.0)
    .resizable(false)
    .center()
    .focused(true)
    .initialization_script(&init)
    .build()
    .map_err(|e| e.to_string())?;

    push_about_version(app);
    Ok(())
}

pub fn app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

pub fn push_about_version(app: &AppHandle) {
    let Some(window) = app.get_webview_window(ABOUT_WINDOW_LABEL) else {
        return;
    };
    let version = serde_json::to_string(&app_version(app)).unwrap_or_else(|_| "\"0.0.0\"".into());
    let script = format!(
        "window.__FARHAD_FLOW_CI_VERSION__ = {version}; window.__farhadAbout && window.__farhadAbout.setVersion({version});"
    );
    let _ = window.eval(&script);
}

/// Splash first paint: show same version string as About.
pub fn push_splash_version(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let version = serde_json::to_string(&app_version(app)).unwrap_or_else(|_| "\"0.0.0\"".into());
    let script = format!(
        "window.__FARHAD_FLOW_CI_VERSION__ = {version}; window.__farhadBoot && window.__farhadBoot.setVersion({version});"
    );
    let _ = window.eval(&script);
}
