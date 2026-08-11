//! Farhad Flow CI — Tauri 2 desktop shell library (Wave 4 boot/watchdog + Wave 5 branding).

mod about;
mod boot;
mod config;
mod sidecar;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use url::Url;

use about::push_splash_version;
use boot::{
    BootSnapshot, BootStage, BootState, HEARTBEAT_INTERVAL_MS, HEARTBEAT_MISS_LIMIT,
};
use config::{is_dev_external_backend, AppPaths};
use sidecar::SidecarHandle;

pub struct AppState {
    pub paths: AppPaths,
    pub sidecar: Arc<SidecarHandle>,
    pub boot: Mutex<BootState>,
    /// Original splash URL so we can return on crash / soft reconnect.
    pub splash_url: Mutex<Option<Url>>,
    /// Set when a restart was requested from splash UI.
    pub restart_requested: Arc<Mutex<bool>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            restart_backend,
            get_boot_snapshot
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let exe = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let paths = AppPaths::resolve(&exe).map_err(|e| e.to_string())?;
            let sidecar = SidecarHandle::new();
            let dev_external = is_dev_external_backend();
            let boot = BootState::new(dev_external);
            let restart_requested = Arc::new(Mutex::new(false));

            let splash_url = app
                .get_webview_window("main")
                .and_then(|w| w.url().ok());

            push_splash_status(&handle, &boot);
            push_splash_version(&handle);

            app.manage(AppState {
                paths: paths.clone(),
                sidecar: Arc::clone(&sidecar),
                boot: Mutex::new(boot),
                splash_url: Mutex::new(splash_url),
                restart_requested: Arc::clone(&restart_requested),
            });

            let paths_bg = paths;
            let sidecar_bg = Arc::clone(&sidecar);
            let handle_bg = handle.clone();
            let restart_bg = Arc::clone(&restart_requested);

            std::thread::Builder::new()
                .name("farhad-boot".into())
                .spawn(move || {
                    run_boot_and_watchdog(handle_bg, paths_bg, sidecar_bg, restart_bg);
                })
                .map_err(|e| e.to_string())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // About window close must not kill sidecar — only main / app Exit.
                if window.label() == "main" {
                    if let Some(state) = window.try_state::<AppState>() {
                        state.sidecar.shutdown(Some(&state.paths));
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Farhad Flow CI")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.sidecar.shutdown(Some(&state.paths));
                }
            }
        });
}

fn run_boot_and_watchdog(
    app: AppHandle,
    paths: AppPaths,
    sidecar: Arc<SidecarHandle>,
    restart_flag: Arc<Mutex<bool>>,
) {
    // Initial boot → Ready → Webview → Running
    {
        let state = app.state::<AppState>();
        let mut boot = state.boot.lock().expect("boot lock");
        push_splash_status(&app, &boot);
        match sidecar::boot_to_ready(&paths, &sidecar, &mut boot) {
            Ok(_) => {
                push_splash_status(&app, &boot);
                if let Err(err) = open_backend_webview(&app, &mut boot) {
                    boot.set_error(err);
                    push_splash_status(&app, &boot);
                    // Fall through to watchdog/restart loop so staff can retry.
                } else {
                    push_splash_status(&app, &boot);
                }
            }
            Err(err) => {
                eprintln!("[FarhadFlowCI] boot: {err}");
                push_splash_status(&app, &boot);
            }
        }
    }

    // Heartbeat + restart button loop
    let mut misses: u32 = 0;
    loop {
        // Splash "Restart backend" sets this flag.
        let want_restart = restart_flag
            .lock()
            .map(|mut g| {
                let v = *g;
                *g = false;
                v
            })
            .unwrap_or(false);

        if want_restart {
            misses = 0;
            let state = app.state::<AppState>();
            let mut boot = state.boot.lock().expect("boot lock");
            boot.set_stage(BootStage::SoftReconnect);
            let _ = show_splash(&app);
            push_splash_status(&app, &boot);
            match sidecar::hard_reset_sidecar(&paths, &sidecar, &mut boot, "user_restart") {
                Ok(_) => {
                    if let Err(err) = open_backend_webview(&app, &mut boot) {
                        boot.set_error(err);
                    }
                    push_splash_status(&app, &boot);
                }
                Err(err) => {
                    boot.set_error(err);
                    push_splash_status(&app, &boot);
                }
            }
            continue;
        }

        let (running, host, port, external) = {
            let state = app.state::<AppState>();
            let boot = state.boot.lock().expect("boot lock");
            (
                matches!(boot.stage, BootStage::Running),
                boot.listen_host.clone(),
                boot.listen_port,
                boot.dev_external,
            )
        };

        if !running {
            std::thread::sleep(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
            continue;
        }

        let Some(port) = port else {
            std::thread::sleep(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
            continue;
        };

        // Unexpected process death (prod only).
        if !external {
            if let Some(code) = sidecar.try_reap() {
                let state = app.state::<AppState>();
                let mut boot = state.boot.lock().expect("boot lock");
                let (path, crumb) = sidecar::write_apoptosis_crumb(
                    &paths,
                    &boot,
                    "process_exit",
                    None,
                    Some(code),
                );
                boot.set_crumb(
                    Some(path.display().to_string()),
                    Some(format!(
                        "process_exit code={code} — {}",
                        crumb.last_log_lines.last().cloned().unwrap_or_default()
                    )),
                );
                boot.set_stage(BootStage::SoftReconnect);
                let _ = show_splash(&app);
                push_splash_status(&app, &boot);
                match sidecar::hard_reset_sidecar(&paths, &sidecar, &mut boot, "process_exit") {
                    Ok(_) => {
                        if let Err(err) = open_backend_webview(&app, &mut boot) {
                            boot.set_error(err);
                        }
                        push_splash_status(&app, &boot);
                        misses = 0;
                    }
                    Err(err) => {
                        boot.set_error(err);
                        push_splash_status(&app, &boot);
                    }
                }
                continue;
            }
        }

        if sidecar::health_ready(&host, port) {
            misses = 0;
        } else {
            misses += 1;
            eprintln!("[FarhadFlowCI] heartbeat miss {misses}/{HEARTBEAT_MISS_LIMIT}");
            if misses >= HEARTBEAT_MISS_LIMIT {
                misses = 0;
                let state = app.state::<AppState>();
                let mut boot = state.boot.lock().expect("boot lock");
                boot.set_stage(BootStage::SoftReconnect);
                let _ = show_splash(&app);
                push_splash_status(&app, &boot);
                match sidecar::hard_reset_sidecar(&paths, &sidecar, &mut boot, "heartbeat_miss") {
                    Ok(_) => {
                        if let Err(err) = open_backend_webview(&app, &mut boot) {
                            boot.set_error(err);
                        }
                        push_splash_status(&app, &boot);
                    }
                    Err(err) => {
                        boot.set_error(err);
                        push_splash_status(&app, &boot);
                    }
                }
            }
        }

        std::thread::sleep(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
    }
}

fn open_backend_webview(app: &AppHandle, boot: &mut BootState) -> Result<(), String> {
    let url = boot
        .backend_url()
        .ok_or_else(|| "no listen port for webview".to_string())?;
    boot.set_stage(BootStage::WebviewOpen);
    push_splash_status(app, boot);
    navigate_main(app, &url)?;
    boot.set_stage(BootStage::Running);
    Ok(())
}

fn show_splash(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let splash = state
        .splash_url
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| "splash URL not captured".to_string())?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    window.navigate(splash).map_err(|e| e.to_string())?;
    // Give splash a tick to load before eval status / version.
    std::thread::sleep(Duration::from_millis(200));
    push_splash_version(app);
    Ok(())
}

fn push_splash_status(app: &AppHandle, boot: &BootState) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let snap = BootSnapshot::from(boot);
    let Ok(json) = serde_json::to_string(&snap) else {
        return;
    };
    let script = format!("window.__farhadBoot && window.__farhadBoot.apply({json});");
    let _ = window.eval(&script);
}

/// Navigate the main webview from splash to the local backend URL.
pub fn navigate_main(app: &AppHandle, url: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    window.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_boot_snapshot(state: State<'_, AppState>) -> Result<BootSnapshot, String> {
    let boot = state.boot.lock().map_err(|e| e.to_string())?;
    Ok(BootSnapshot::from(&*boot))
}

#[tauri::command]
fn restart_backend(state: State<'_, AppState>) -> Result<(), String> {
    let mut flag = state.restart_requested.lock().map_err(|e| e.to_string())?;
    *flag = true;
    // Optimistic splash update while watchdog thread picks up the flag.
    if let Ok(mut boot) = state.boot.lock() {
        boot.set_stage(BootStage::SoftReconnect);
    }
    Ok(())
}
