//! Sidecar process control: spawn, health, heartbeat, process-tree kill, apoptosis crumbs.
//!
//! Wave 4 — full prod path (no stubs). DEV (`FARHAD_FLOW_CI_DEV=1`) attaches only.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::boot::{
    BootStage, BootState, DEFAULT_PORT, HEALTH_POLL_INTERVAL_MS, HEALTH_TIMEOUT_SECS, PORT_RANGE,
};
use crate::config::AppPaths;

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Handle for the Python/langflow sidecar. Shared via `AppState`.
#[derive(Debug, Default)]
pub struct SidecarHandle {
    inner: Mutex<SidecarInner>,
}

#[derive(Debug, Default)]
struct SidecarInner {
    child: Option<Child>,
    listen_port: Option<u16>,
    /// When true, shell did not own the process (`FARHAD_FLOW_CI_DEV=1`).
    external: bool,
    /// Unix process group id / Windows job handle tracked for tree kill.
    #[cfg(unix)]
    pgid: Option<i32>,
    #[cfg(windows)]
    job: Option<windows_job::JobObject>,
}

#[derive(Debug, Clone)]
pub struct SpawnPlan {
    pub host: String,
    pub port: u16,
    pub python: PathBuf,
    pub frontend_path: PathBuf,
    pub working_dir: PathBuf,
    pub log_file: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApoptosisCrumb {
    pub stage: String,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub last_log_lines: Vec<String>,
    pub ts_unix: u64,
    pub port: Option<u16>,
    pub reason: String,
}

/// Persisted across unclean shell exits so next boot can reap orphan Python.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SidecarLease {
    pid: u32,
    #[serde(default)]
    pgid: Option<i32>,
    python: String,
    ts_unix: u64,
}

impl SidecarHandle {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn listen_port(&self) -> Option<u16> {
        self.inner.lock().ok().and_then(|g| g.listen_port)
    }

    pub fn is_external(&self) -> bool {
        self.inner.lock().ok().map(|g| g.external).unwrap_or(false)
    }

    pub fn child_pid(&self) -> Option<u32> {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.child.as_ref().map(|c| c.id()))
    }

    /// Attach to an already-running backend (dev escape hatch). Does not spawn.
    pub fn attach_external(&self, _host: &str, port: u16) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.external = true;
            guard.listen_port = Some(port);
            guard.child = None;
            #[cfg(unix)]
            {
                guard.pgid = None;
            }
            #[cfg(windows)]
            {
                guard.job = None;
            }
        }
    }

    pub fn plan_spawn(paths: &AppPaths, port: u16) -> SpawnPlan {
        SpawnPlan {
            host: "127.0.0.1".into(),
            port,
            python: paths.python_binary(),
            frontend_path: paths.frontend_dir(),
            working_dir: paths.resources_dir.clone(),
            log_file: paths.sidecar_log_file(),
        }
    }

    /// Spawn sidecar with env + PATH + GIT_EXEC_PATH; log to `{config_dir}/logs/sidecar.log`.
    pub fn spawn_prod(&self, paths: &AppPaths, port: u16) -> Result<u16, SidecarError> {
        let plan = Self::plan_spawn(paths, port);
        if !plan.python.is_file() {
            return Err(SidecarError::MissingResource(format!(
                "python binary missing: {}",
                plan.python.display()
            )));
        }
        if !plan.frontend_path.join("index.html").is_file() {
            return Err(SidecarError::MissingResource(format!(
                "frontend missing: {}/index.html",
                plan.frontend_path.display()
            )));
        }

        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&plan.log_file)
            .map_err(SidecarError::Io)?;
        {
            let mut header = log.try_clone().map_err(SidecarError::Io)?;
            let _ = writeln!(
                header,
                "\n----- sidecar spawn {} port={} -----\n",
                ts_unix(),
                port
            );
        }
        let log_err = log.try_clone().map_err(SidecarError::Io)?;

        let frontend = plan
            .frontend_path
            .to_str()
            .ok_or_else(|| SidecarError::InvalidPath(plan.frontend_path.clone()))?;

        // Prefer relocatable boot script: `site.addsitedir` processes pywin32 .pth
        // (plain `PYTHONPATH` + `python -m langflow` does not → ModuleNotFoundError: pywintypes).
        let boot = paths.langflow_boot_script();
        let use_boot = boot.is_file();

        let mut cmd = Command::new(&plan.python);
        if use_boot {
            let boot_s = boot
                .to_str()
                .ok_or_else(|| SidecarError::InvalidPath(boot.clone()))?;
            cmd.args([
                boot_s,
                "run",
                "--host",
                &plan.host,
                "--port",
                &port.to_string(),
                "--frontend-path",
                frontend,
            ]);
        } else {
            cmd.args([
                "-m",
                "langflow",
                "run",
                "--host",
                &plan.host,
                "--port",
                &port.to_string(),
                "--frontend-path",
                frontend,
            ]);
        }
        cmd.current_dir(&plan.working_dir)
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .stdin(Stdio::null());

        apply_sidecar_env(&mut cmd, paths, port)?;

        #[cfg(unix)]
        {
            unsafe {
                cmd.pre_exec(|| {
                    // New process group so we can kill the whole tree via killpg.
                    if libc::setpgid(0, 0) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }

        #[cfg(windows)]
        {
            // Hide console for python.exe / taskkill children (pythonw alone is not enough
            // if any subprocess is a console binary).
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        #[cfg(windows)]
        let job = windows_job::JobObject::create().map_err(SidecarError::Io)?;

        let child = cmd.spawn().map_err(|e| {
            SidecarError::SpawnFailed(format!("{}: {e}", plan.python.display()))
        })?;

        #[cfg(windows)]
        {
            job.assign_pid(child.id()).map_err(SidecarError::Io)?;
        }

        let pid = child.id();
        if let Ok(mut guard) = self.inner.lock() {
            // Replace any prior child without leaking (should already be cleared).
            if let Some(mut old) = guard.child.take() {
                let _ = old.kill();
                let _ = old.wait();
            }
            guard.child = Some(child);
            guard.listen_port = Some(port);
            guard.external = false;
            #[cfg(unix)]
            {
                guard.pgid = Some(pid as i32);
            }
            #[cfg(windows)]
            {
                guard.job = Some(job);
            }
        }

        write_sidecar_lease(
            paths,
            SidecarLease {
                pid,
                #[cfg(unix)]
                pgid: Some(pid as i32),
                #[cfg(windows)]
                pgid: None,
                python: plan.python.display().to_string(),
                ts_unix: ts_unix(),
            },
        );

        eprintln!("[FarhadFlowCI] sidecar spawned pid={pid} port={port}");
        Ok(port)
    }

    /// Graceful / hard shutdown — always safe from close handler.
    pub fn shutdown(&self, paths: Option<&AppPaths>) {
        self.kill_process_tree("shutdown");
        if let Some(paths) = paths {
            clear_sidecar_lease(paths);
        }
    }

    /// Kill owned sidecar process tree (Unix process group / Windows Job Object).
    pub fn kill_process_tree(&self, reason: &str) {
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        if guard.external {
            guard.listen_port = None;
            return;
        }

        #[cfg(unix)]
        {
            if let Some(pgid) = guard.pgid.take() {
                unsafe {
                    let _ = libc::killpg(pgid, libc::SIGTERM);
                }
                std::thread::sleep(Duration::from_millis(400));
                unsafe {
                    let _ = libc::killpg(pgid, libc::SIGKILL);
                }
            }
        }

        #[cfg(windows)]
        {
            if let Some(job) = guard.job.take() {
                let _ = job.terminate();
            }
        }

        if let Some(mut child) = guard.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        guard.listen_port = None;
        eprintln!("[FarhadFlowCI] sidecar kill_process_tree reason={reason}");
    }

    /// Try wait without blocking forever — returns exit code if exited.
    pub fn try_reap(&self) -> Option<i32> {
        let Ok(mut guard) = self.inner.lock() else {
            return None;
        };
        let child = guard.child.as_mut()?;
        match child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code().unwrap_or(-1);
                guard.child = None;
                #[cfg(unix)]
                {
                    guard.pgid = None;
                }
                #[cfg(windows)]
                {
                    guard.job = None;
                }
                Some(code)
            }
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("missing resource: {0}")]
    MissingResource(String),
    #[error("invalid path: {0}")]
    InvalidPath(PathBuf),
    #[error("no free listen port in {0}..={1}")]
    NoFreePort(u16, u16),
    #[error("sidecar spawn failed: {0}")]
    SpawnFailed(String),
    #[error("health ready timeout after {0}s (port {1})")]
    HealthTimeout(u64, u16),
    #[error("stage0 failed: {0}")]
    Stage0(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Stage0: resolve/verify resources + config_dir (config_dir already created in `AppPaths::resolve`).
pub fn stage0_verify(paths: &AppPaths) -> Result<(), SidecarError> {
    let mut errors: Vec<String> = Vec::new();

    let py = paths.python_binary();
    if !py.is_file() {
        errors.push(format!("python missing: {}", py.display()));
    }

    let fe = paths.frontend_index();
    if !fe.is_file() {
        errors.push(format!("frontend index missing: {}", fe.display()));
    }

    let git = paths.git_binary();
    if !git.is_file() {
        errors.push(format!(
            "bundled git missing: {} (Stage0 refuses system-git drift)",
            git.display()
        ));
    }

    let exec = paths.git_exec_path();
    if !exec.is_dir() {
        errors.push(format!("GIT_EXEC_PATH dir missing: {}", exec.display()));
    }

    if !paths.config_dir.is_dir() {
        errors.push(format!("config_dir missing: {}", paths.config_dir.display()));
    }
    if !paths.logs_dir.is_dir() {
        errors.push(format!("logs_dir missing: {}", paths.logs_dir.display()));
    }

    // Optional integrity: if MANIFEST lists critical paths, ensure they exist.
    let manifest = paths.manifest_file();
    if manifest.is_file() {
        if let Err(e) = verify_manifest_critical(&manifest, paths) {
            errors.push(e);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(SidecarError::Stage0(errors.join("; ")))
    }
}

fn verify_manifest_critical(manifest: &Path, paths: &AppPaths) -> Result<(), String> {
    let text = std::fs::read_to_string(manifest).map_err(|e| e.to_string())?;
    let critical = [
        paths.python_binary(),
        paths.frontend_index(),
        paths.default_env_file(),
    ];
    for path in critical {
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        // Manifest may use relative paths; require the file on disk either way.
        if !path.is_file() {
            return Err(format!(
                "MANIFEST critical missing on disk: {} (looked for name {name})",
                path.display()
            ));
        }
        let _ = text; // presence check is enough for boot; full sha is CI concern
    }
    Ok(())
}

fn apply_sidecar_env(cmd: &mut Command, paths: &AppPaths, port: u16) -> Result<(), SidecarError> {
    // Start from a clean slate for keys we own; inherit the rest.
    let mut env_map = load_default_env(&paths.default_env_file());

    env_map.insert("LANGFLOW_HOST".into(), "127.0.0.1".into());
    env_map.insert("LANGFLOW_PORT".into(), port.to_string());
    // Staff product: never auto-commit on Save (manual History commit only).
    env_map.insert("LANGFLOW_GIT_AUTO_COMMIT".into(), "false".into());
    // Never wipe/rebuild starter projects on every boot (upstream default is true).
    env_map.insert("LANGFLOW_UPDATE_STARTER_PROJECTS".into(), "false".into());
    // Frozen venvs: pip extension.json scan is ~40–50s and unused for this product.
    env_map.insert("LANGFLOW_SKIP_EXTENSION_COMPONENTS".into(), "true".into());
    env_map.insert(
        "LANGFLOW_CONFIG_DIR".into(),
        paths.config_dir.to_string_lossy().into_owned(),
    );
    // Install/resources tree is not writable — keep SQLite under config_dir.
    env_map.insert("LANGFLOW_SAVE_DB_IN_CONFIG_DIR".into(), "true".into());
    // Intentionally do NOT set LANGFLOW_GIT_FLOWS_DIR → flows-repo under config_dir.
    env_map.insert("PYTHONNOUSERSITE".into(), "1".into());
    env_map.insert(
        "VIRTUAL_ENV".into(),
        paths
            .resources_dir
            .join("venv")
            .to_string_lossy()
            .into_owned(),
    );

    if let Some(site) = paths.venv_site_packages() {
        let existing = std::env::var("PYTHONPATH").unwrap_or_default();
        let mut parts: Vec<String> = Vec::new();
        // `tauri dev`: prefer live workspace packages over frozen venv copies.
        #[cfg(debug_assertions)]
        {
            let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
            for rel in ["src/backend/base", "src/lfx/src", "src/sdk/src"] {
                let p = repo.join(rel);
                if p.is_dir() {
                    parts.push(p.to_string_lossy().into_owned());
                }
            }
        }
        parts.push(site.to_string_lossy().into_owned());
        if !existing.is_empty() {
            parts.push(existing);
        }
        env_map.insert("PYTHONPATH".into(), parts.join(path_sep()));
    }

    let prepend = paths.sidecar_path_prepend();
    let prepend_str = join_paths(&prepend);
    let old_path = std::env::var("PATH").unwrap_or_default();
    let new_path = if old_path.is_empty() {
        prepend_str
    } else {
        format!("{prepend_str}{}{old_path}", path_sep())
    };
    env_map.insert("PATH".into(), new_path);

    let git_exec = paths.git_exec_path();
    env_map.insert(
        "GIT_EXEC_PATH".into(),
        git_exec.to_string_lossy().into_owned(),
    );

    #[cfg(unix)]
    if let Some(lib) = paths.python_lib_dir() {
        let old = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
        let merged = if old.is_empty() {
            lib.to_string_lossy().into_owned()
        } else {
            format!("{}:{old}", lib.display())
        };
        env_map.insert("LD_LIBRARY_PATH".into(), merged);
    }

    for (k, v) in env_map {
        cmd.env(k, v);
    }
    Ok(())
}

fn path_sep() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

fn join_paths(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .filter(|p| p.as_os_str().len() > 0)
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(path_sep())
}

fn load_default_env(path: &Path) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return map;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let k = k.trim();
        if k.is_empty() {
            continue;
        }
        map.insert(k.to_string(), v.trim().to_string());
    }
    map
}

/// Pick first free port in 7860..=7870.
pub fn pick_listen_port() -> Result<u16, SidecarError> {
    for port in PORT_RANGE {
        if port_free(port) {
            return Ok(port);
        }
    }
    Err(SidecarError::NoFreePort(
        *PORT_RANGE.start(),
        *PORT_RANGE.end(),
    ))
}

fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// GET /health or /api/v1/git/health → READY when HTTP 200.
pub fn health_ready(host: &str, port: u16) -> bool {
    let urls = [
        format!("http://{host}:{port}/health"),
        format!("http://{host}:{port}/api/v1/git/health"),
    ];
    for url in urls {
        if http_ok(&url) {
            return true;
        }
    }
    false
}

fn http_ok(url: &str) -> bool {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(400))
        .timeout_read(Duration::from_secs(2))
        .build();
    match agent.get(url).call() {
        Ok(resp) => (200..300).contains(&resp.status()),
        Err(_) => false,
    }
}

pub fn wait_until_ready(host: &str, port: u16) -> Result<(), SidecarError> {
    let deadline = Instant::now() + Duration::from_secs(HEALTH_TIMEOUT_SECS);
    while Instant::now() < deadline {
        if health_ready(host, port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS));
    }
    Err(SidecarError::HealthTimeout(HEALTH_TIMEOUT_SECS, port))
}

/// Find a port in range that already answers health (DEV attach).
pub fn find_external_ready_port(host: &str) -> Option<u16> {
    for port in PORT_RANGE {
        if health_ready(host, port) {
            return Some(port);
        }
    }
    None
}

pub fn write_apoptosis_crumb(
    paths: &AppPaths,
    boot: &BootState,
    reason: &str,
    pid: Option<u32>,
    exit_code: Option<i32>,
) -> (PathBuf, ApoptosisCrumb) {
    let crumb = ApoptosisCrumb {
        stage: boot.stage.label().into(),
        pid,
        exit_code,
        last_log_lines: tail_log_lines(&paths.sidecar_log_file(), 40),
        ts_unix: ts_unix(),
        port: boot.listen_port,
        reason: reason.into(),
    };
    let path = paths.apoptosis_crumb_file();
    if let Ok(json) = serde_json::to_string_pretty(&crumb) {
        let _ = std::fs::write(&path, json);
    }
    (path, crumb)
}

fn tail_log_lines(path: &Path, max: usize) -> Vec<String> {
    let Ok(mut f) = File::open(path) else {
        return Vec::new();
    };
    let Ok(meta) = f.metadata() else {
        return Vec::new();
    };
    let len = meta.len();
    let start = len.saturating_sub(32 * 1024);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut buf = String::new();
    let _ = f.read_to_string(&mut buf);
    let lines: Vec<String> = buf.lines().map(|s| s.to_string()).collect();
    if lines.len() <= max {
        lines
    } else {
        lines[lines.len() - max..].to_vec()
    }
}

fn ts_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn write_sidecar_lease(paths: &AppPaths, lease: SidecarLease) {
    let path = paths.sidecar_lease_file();
    if let Ok(json) = serde_json::to_string_pretty(&lease) {
        let _ = std::fs::write(&path, json);
    }
}

fn clear_sidecar_lease(paths: &AppPaths) {
    let path = paths.sidecar_lease_file();
    let _ = std::fs::remove_file(&path);
}

/// Next-boot + pre-spawn: kill leftover langflow Python from unclean shell exit.
pub fn reap_orphan_sidecars(paths: &AppPaths) {
    let lease_path = paths.sidecar_lease_file();
    let Ok(text) = std::fs::read_to_string(&lease_path) else {
        return;
    };
    let Ok(lease) = serde_json::from_str::<SidecarLease>(&text) else {
        let _ = std::fs::remove_file(&lease_path);
        return;
    };

    let expected = PathBuf::from(&lease.python);
    if orphan_still_ours(lease.pid, &expected) {
        eprintln!(
            "[FarhadFlowCI] orphan reaper: killing leftover sidecar pid={} python={}",
            lease.pid, lease.python
        );
        kill_orphan_pid(lease.pid, lease.pgid);
    } else {
        eprintln!(
            "[FarhadFlowCI] orphan reaper: stale lease pid={} (not ours / already gone)",
            lease.pid
        );
    }
    let _ = std::fs::remove_file(&lease_path);
}

fn orphan_still_ours(pid: u32, expected_python: &Path) -> bool {
    #[cfg(unix)]
    {
        let proc = format!("/proc/{pid}");
        if !Path::new(&proc).exists() {
            return false;
        }
        if let Ok(exe) = std::fs::read_link(format!("/proc/{pid}/exe")) {
            if exe == expected_python {
                return true;
            }
            // Broken symlink after delete still may match via cmdline.
            let exe_s = exe.to_string_lossy();
            let expect_s = expected_python.to_string_lossy();
            if exe_s.contains(expect_s.as_ref()) {
                return true;
            }
        }
        if let Ok(raw) = std::fs::read(format!("/proc/{pid}/cmdline")) {
            let s = String::from_utf8_lossy(&raw);
            let expect_s = expected_python.to_string_lossy();
            return s.contains(expect_s.as_ref()) && s.contains("langflow");
        }
        false
    }
    #[cfg(windows)]
    {
        let _ = expected_python;
        windows_process_alive(pid)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (pid, expected_python);
        false
    }
}

fn kill_orphan_pid(pid: u32, pgid: Option<i32>) {
    #[cfg(unix)]
    {
        if let Some(pgid) = pgid {
            unsafe {
                let _ = libc::killpg(pgid, libc::SIGTERM);
            }
            std::thread::sleep(Duration::from_millis(400));
            unsafe {
                let _ = libc::killpg(pgid, libc::SIGKILL);
            }
        }
        unsafe {
            let _ = libc::kill(pid as i32, libc::SIGTERM);
        }
        std::thread::sleep(Duration::from_millis(200));
        unsafe {
            let _ = libc::kill(pid as i32, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = pgid;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

#[cfg(windows)]
fn windows_process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == STILL_ACTIVE as u32
    }
}

/// Synchronous Stage0→Spawn→Ready for prod (caller does Webview). DEV attaches.
pub fn boot_to_ready(
    paths: &AppPaths,
    sidecar: &SidecarHandle,
    boot: &mut BootState,
) -> Result<BootStage, String> {
    boot.set_stage(BootStage::Paths);

    if boot.dev_external {
        boot.set_stage(BootStage::ExternalAttach);
        let host = boot.listen_host.clone();
        let port = find_external_ready_port(&host).unwrap_or(DEFAULT_PORT);
        sidecar.attach_external(&host, port);
        boot.listen_port = Some(port);
        // Still wait briefly if backend is mid-start.
        if !health_ready(&host, port) {
            let _ = wait_until_ready(&host, port);
        }
        if health_ready(&host, port) {
            boot.set_stage(BootStage::Ready);
            Ok(BootStage::Ready)
        } else {
            let msg = format!(
                "DEV attach: no healthy backend on {host}:{port} (scanned {}..={})",
                PORT_RANGE.start(),
                PORT_RANGE.end()
            );
            boot.set_error(msg.clone());
            Err(msg)
        }
    } else {
        // Wave 10: unclean prior exit may leave Python holding 7860–7870.
        reap_orphan_sidecars(paths);

        stage0_verify(paths).map_err(|e| {
            boot.set_error(e.to_string());
            e.to_string()
        })?;

        boot.set_stage(BootStage::Spawn);
        let port = pick_listen_port().map_err(|e| {
            boot.set_error(e.to_string());
            e.to_string()
        })?;
        let bound = sidecar.spawn_prod(paths, port).map_err(|e| {
            boot.set_error(e.to_string());
            e.to_string()
        })?;
        boot.listen_port = Some(bound);

        wait_until_ready(&boot.listen_host, bound).map_err(|e| {
            let pid = sidecar.child_pid();
            let (path, crumb) =
                write_apoptosis_crumb(paths, boot, "health_timeout", pid, sidecar.try_reap());
            boot.set_crumb(
                Some(path.display().to_string()),
                Some(format!(
                    "{} — pid={:?} exit={:?} (see {})",
                    crumb.reason,
                    crumb.pid,
                    crumb.exit_code,
                    path.display()
                )),
            );
            sidecar.kill_process_tree("health_timeout");
            clear_sidecar_lease(paths);
            boot.set_error(e.to_string());
            e.to_string()
        })?;

        boot.set_stage(BootStage::Ready);
        Ok(BootStage::Ready)
    }
}

/// Kill tree + respawn + wait READY (used by watchdog / restart button).
pub fn hard_reset_sidecar(
    paths: &AppPaths,
    sidecar: &SidecarHandle,
    boot: &mut BootState,
    reason: &str,
) -> Result<u16, String> {
    if boot.dev_external {
        let host = boot.listen_host.clone();
        let port = find_external_ready_port(&host).unwrap_or(DEFAULT_PORT);
        sidecar.attach_external(&host, port);
        boot.listen_port = Some(port);
        wait_until_ready(&host, port).map_err(|e| e.to_string())?;
        return Ok(port);
    }

    let pid = sidecar.child_pid();
    let exit = sidecar.try_reap();
    let (path, crumb) = write_apoptosis_crumb(paths, boot, reason, pid, exit);
    boot.set_crumb(
        Some(path.display().to_string()),
        Some(format!(
            "{reason} — pid={:?} exit={:?} lines={}",
            crumb.pid,
            crumb.exit_code,
            crumb.last_log_lines.len()
        )),
    );

    sidecar.kill_process_tree(reason);
    boot.set_stage(BootStage::SoftReconnect);

    stage0_verify(paths).map_err(|e| e.to_string())?;
    boot.set_stage(BootStage::Spawn);
    let port = pick_listen_port().map_err(|e| e.to_string())?;
    let bound = sidecar.spawn_prod(paths, port).map_err(|e| e.to_string())?;
    boot.listen_port = Some(bound);
    wait_until_ready(&boot.listen_host, bound).map_err(|e| e.to_string())?;
    boot.set_stage(BootStage::Ready);
    Ok(bound)
}

#[cfg(windows)]
mod windows_job {
    use std::io;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};

    #[derive(Debug)]
    pub struct JobObject {
        handle: HANDLE,
    }

    // HANDLE is a raw pointer in windows-sys; job object handles are safe to move across threads.
    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn create() -> io::Result<Self> {
            unsafe {
                let handle = CreateJobObjectW(ptr::null(), ptr::null());
                if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                    return Err(io::Error::last_os_error());
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    let err = io::Error::last_os_error();
                    CloseHandle(handle);
                    return Err(err);
                }
                Ok(Self { handle })
            }
        }

        pub fn assign_pid(&self, pid: u32) -> io::Result<()> {
            unsafe {
                let proc = OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
                if proc.is_null() || proc == INVALID_HANDLE_VALUE {
                    return Err(io::Error::last_os_error());
                }
                let ok = AssignProcessToJobObject(self.handle, proc);
                let err = if ok == 0 {
                    Some(io::Error::last_os_error())
                } else {
                    None
                };
                CloseHandle(proc);
                match err {
                    Some(e) => Err(e),
                    None => Ok(()),
                }
            }
        }

        pub fn terminate(&self) -> io::Result<()> {
            unsafe {
                if TerminateJobObject(self.handle, 1) == 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                // KILL_ON_JOB_CLOSE terminates remaining children.
                CloseHandle(self.handle);
            }
        }
    }
}
