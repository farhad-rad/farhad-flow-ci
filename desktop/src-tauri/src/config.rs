//! Install dir + config dir resolution for Farhad Flow CI desktop.

use std::env;
use std::path::{Path, PathBuf};

#[cfg(windows)]
use directories::ProjectDirs;
use thiserror::Error;

pub const PRODUCT_QUALIFIER: &str = "ci";
pub const PRODUCT_ORGANIZATION: &str = "zeenome";
pub const PRODUCT_APPLICATION: &str = "FarhadFlowCI";

/// Ubuntu package install prefix (ARCHITECTURE).
pub const LINUX_INSTALL_DIR: &str = "/opt/farhad-flow-ci";

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("could not resolve user directories for Farhad Flow CI")]
    NoProjectDirs,
    #[error("could not create config dir {0}: {1}")]
    CreateConfigDir(PathBuf, #[source] std::io::Error),
    #[error("could not create logs dir {0}: {1}")]
    CreateLogsDir(PathBuf, #[source] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    /// Directory that contains the FarhadFlowCI binary (or cargo target in dev).
    pub install_dir: PathBuf,
    /// Bundled `resources/` tree (python, venv, frontend, git, env).
    pub resources_dir: PathBuf,
    /// User config dir (`LANGFLOW_CONFIG_DIR` or OS defaults below).
    pub config_dir: PathBuf,
    /// Default flows SoT when `LANGFLOW_GIT_FLOWS_DIR` unset.
    pub flows_repo_dir: PathBuf,
    /// Sidecar log directory under config.
    pub logs_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve(exe: &Path) -> Result<Self, ConfigError> {
        let install_dir = resolve_install_dir(exe);
        let resources_dir = resolve_resources_dir(&install_dir, exe);
        let config_dir = resolve_config_dir()?;
        let flows_repo_dir = config_dir.join("flows-repo");
        let logs_dir = config_dir.join("logs");

        std::fs::create_dir_all(&config_dir)
            .map_err(|e| ConfigError::CreateConfigDir(config_dir.clone(), e))?;
        std::fs::create_dir_all(&logs_dir)
            .map_err(|e| ConfigError::CreateLogsDir(logs_dir.clone(), e))?;

        Ok(Self {
            install_dir,
            resources_dir,
            config_dir,
            flows_repo_dir,
            logs_dir,
        })
    }

    pub fn default_env_file(&self) -> PathBuf {
        self.resources_dir.join("env").join("default.env")
    }

    pub fn sidecar_log_file(&self) -> PathBuf {
        self.logs_dir.join("sidecar.log")
    }

    pub fn apoptosis_crumb_file(&self) -> PathBuf {
        self.logs_dir.join("apoptosis-crumb.json")
    }

    /// Last owned sidecar process lease — next-boot orphan reaper (Wave 10).
    pub fn sidecar_lease_file(&self) -> PathBuf {
        self.logs_dir.join("sidecar-lease.json")
    }

    pub fn python_binary(&self) -> PathBuf {
        if cfg!(windows) {
            // Prefer pythonw.exe so the sidecar does not open a console window.
            let pythonw = self.resources_dir.join("python").join("pythonw.exe");
            if pythonw.is_file() {
                return pythonw;
            }
            self.resources_dir.join("python").join("python.exe")
        } else {
            let p3 = self.resources_dir.join("python").join("bin").join("python3");
            if p3.exists() {
                p3
            } else {
                self.resources_dir.join("python").join("bin").join("python")
            }
        }
    }

    /// Relocatable langflow entry that runs `site.addsitedir` (needed for pywin32 .pth).
    pub fn langflow_boot_script(&self) -> PathBuf {
        self.resources_dir.join("_langflow_boot.py")
    }

    pub fn frontend_dir(&self) -> PathBuf {
        self.resources_dir.join("frontend")
    }

    pub fn frontend_index(&self) -> PathBuf {
        self.frontend_dir().join("index.html")
    }

    pub fn git_root(&self) -> PathBuf {
        self.resources_dir.join("git")
    }

    /// Bundled git executable (fail Stage0 if missing).
    pub fn git_binary(&self) -> PathBuf {
        if cfg!(windows) {
            let cmd = self.git_root().join("cmd").join("git.exe");
            if cmd.exists() {
                return cmd;
            }
            self.git_root().join("bin").join("git.exe")
        } else {
            self.git_root().join("bin").join("git")
        }
    }

    pub fn git_exec_path(&self) -> PathBuf {
        if cfg!(windows) {
            self.git_root()
                .join("mingw64")
                .join("libexec")
                .join("git-core")
        } else {
            self.git_root().join("libexec").join("git-core")
        }
    }

    /// PATH segments to prepend for the sidecar only (git + python + venv).
    pub fn sidecar_path_prepend(&self) -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        if cfg!(windows) {
            let git = self.git_root();
            dirs.push(git.join("cmd"));
            dirs.push(git.join("usr").join("bin"));
            dirs.push(git.join("mingw64").join("bin"));
            dirs.push(self.resources_dir.join("python"));
            let dlls = self.resources_dir.join("python").join("DLLs");
            if dlls.is_dir() {
                dirs.push(dlls);
            }
            dirs.push(self.resources_dir.join("venv").join("Scripts"));
            // pywin32: DLL + win32 packages must be on PATH (also loaded via .pth / addsitedir).
            let site = self.resources_dir.join("venv").join("Lib").join("site-packages");
            for rel in ["pywin32_system32", "win32", "win32/lib"] {
                let p = site.join(rel);
                if p.is_dir() {
                    dirs.push(p);
                }
            }
            // onnxruntime (magika/markitdown): native DLLs live beside the .pyd.
            let ort = site.join("onnxruntime").join("capi");
            if ort.is_dir() {
                dirs.push(ort);
            }
        } else {
            dirs.push(self.git_root().join("bin"));
            dirs.push(self.resources_dir.join("venv").join("bin"));
            dirs.push(self.resources_dir.join("python").join("bin"));
        }
        dirs
    }

    pub fn python_lib_dir(&self) -> Option<PathBuf> {
        let lib = self.resources_dir.join("python").join("lib");
        lib.is_dir().then_some(lib)
    }

    /// Prefer `venv/lib/pythonX.Y/site-packages` (Linux) or `venv/Lib/site-packages` (Windows).
    pub fn venv_site_packages(&self) -> Option<PathBuf> {
        #[cfg(windows)]
        {
            let p = self.resources_dir.join("venv").join("Lib").join("site-packages");
            if p.is_dir() {
                return Some(p);
            }
        }
        let lib = self.resources_dir.join("venv").join("lib");
        if let Ok(entries) = std::fs::read_dir(&lib) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("python") {
                    let site = entry.path().join("site-packages");
                    if site.is_dir() {
                        return Some(site);
                    }
                }
            }
        }
        None
    }

    pub fn manifest_file(&self) -> PathBuf {
        self.resources_dir.join("MANIFEST.sha256")
    }
}

fn resolve_install_dir(exe: &Path) -> PathBuf {
    if let Ok(override_dir) = env::var("FARHAD_FLOW_CI_INSTALL_DIR") {
        return PathBuf::from(override_dir);
    }

    #[cfg(target_os = "linux")]
    {
        let packaged = PathBuf::from(LINUX_INSTALL_DIR);
        if packaged.join("FarhadFlowCI").exists() || packaged.join("resources").exists() {
            return packaged;
        }
    }

    // Windows: install dir is whatever NSIS chose (Program Files / other drive /
    // per-user). Always trust the running exe location — do not prefer LocalAppData.
    exe.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_resources_dir(install_dir: &Path, exe: &Path) -> PathBuf {
    // Packaged: /opt prefix (postinst), Tauri deb /usr/lib/<product>/resources, or beside binary.
    // Debug/`tauri dev`: prefer desktop/resources so local payload + PYTHONPATH source win over
    // a previously installed /usr/lib/... tree on the same machine.
    let mut candidates: Vec<PathBuf> = Vec::new();

    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources"));
    }

    candidates.extend([
        install_dir.join("resources"),
        PathBuf::from(LINUX_INSTALL_DIR).join("resources"),
        PathBuf::from("/usr/lib/Farhad Flow CI/resources"),
        PathBuf::from("/usr/lib/FarhadFlowCI/resources"),
        PathBuf::from("/usr/lib/farhad-flow-ci/resources"),
        exe.parent()
            .map(|p| p.join("resources"))
            .unwrap_or_else(|| PathBuf::from("resources")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources"),
        exe.parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("lib").join("Farhad Flow CI").join("resources"))
            .unwrap_or_else(|| PathBuf::from("resources")),
        exe.parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("lib").join("FarhadFlowCI").join("resources"))
            .unwrap_or_else(|| PathBuf::from("resources")),
        exe.parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("lib").join("farhad-flow-ci").join("resources"))
            .unwrap_or_else(|| PathBuf::from("resources")),
        exe.parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("resources"))
            .unwrap_or_else(|| PathBuf::from("resources")),
    ]);

    // Relative ../lib/<exe_name>/resources from /usr/bin (Tauri Linux default)
    if let Some(exe_dir) = exe.parent() {
        if let Some(name) = exe.file_name() {
            candidates.push(exe_dir.join("../lib").join(name).join("resources"));
        }
    }

    for candidate in candidates {
        if let Ok(canonical) = candidate.canonicalize() {
            if canonical.is_dir() {
                return canonical;
            }
        } else if candidate.is_dir() {
            return candidate;
        }
    }

    install_dir.join("resources")
}

fn resolve_config_dir() -> Result<PathBuf, ConfigError> {
    if let Ok(override_dir) = env::var("LANGFLOW_CONFIG_DIR") {
        return Ok(PathBuf::from(override_dir));
    }

    // Windows: %APPDATA%\zeenome\FarhadFlowCI\
    // Ubuntu/Linux: ~/app_data/zeenome/farhad-flow-ci/  (staff path; not XDG)
    #[cfg(windows)]
    {
        return ProjectDirs::from(PRODUCT_QUALIFIER, PRODUCT_ORGANIZATION, PRODUCT_APPLICATION)
            .map(|dirs| dirs.config_dir().to_path_buf())
            .ok_or(ConfigError::NoProjectDirs);
    }

    #[cfg(not(windows))]
    {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or(ConfigError::NoProjectDirs)?;
        Ok(home
            .join("app_data")
            .join("zeenome")
            .join("farhad-flow-ci"))
    }
}

/// True when staff debug wants an already-running backend (no spawn).
pub fn is_dev_external_backend() -> bool {
    matches!(
        env::var("FARHAD_FLOW_CI_DEV").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_defaults_match_lock() {
        assert_eq!(crate::boot::DEFAULT_PORT, 7860);
    }
}
