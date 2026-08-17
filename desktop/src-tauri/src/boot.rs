//! Boot FSM for Farhad Flow CI desktop shell (Wave 4).

use serde::{Deserialize, Serialize};

/// Desktop boot stages (see `desktop/ARCHITECTURE.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BootStage {
    #[default]
    Paths,
    Spawn,
    Ready,
    WebviewOpen,
    Running,
    /// Heartbeat miss → kill tree → respawn in progress.
    SoftReconnect,
    /// Staff debug path when `FARHAD_FLOW_CI_DEV=1` attaches to an external backend.
    ExternalAttach,
    Error,
}

impl BootStage {
    pub fn label(self) -> &'static str {
        match self {
            BootStage::Paths => "Paths",
            BootStage::Spawn => "Spawn",
            BootStage::Ready => "Ready",
            BootStage::WebviewOpen => "WebviewOpen",
            BootStage::Running => "Running",
            BootStage::SoftReconnect => "SoftReconnect",
            BootStage::ExternalAttach => "ExternalAttach",
            BootStage::Error => "Error",
        }
    }

    pub fn splash_message(self) -> &'static str {
        match self {
            BootStage::Paths => "Resolving install and config paths…",
            BootStage::Spawn => "Starting backend…",
            BootStage::Ready => "Backend ready.",
            BootStage::WebviewOpen => "Opening Farhad Flow CI…",
            BootStage::Running => "Running.",
            BootStage::SoftReconnect => "Backend lost — reconnecting…",
            BootStage::ExternalAttach => "Dev mode — attaching to external backend…",
            BootStage::Error => "Boot failed. See logs.",
        }
    }

    pub fn is_error(self) -> bool {
        matches!(self, BootStage::Error)
    }

    pub fn show_restart(self) -> bool {
        matches!(self, BootStage::Error | BootStage::SoftReconnect)
    }
}

/// Mutable boot progress held in app state.
#[derive(Debug, Clone, Serialize)]
pub struct BootState {
    pub stage: BootStage,
    pub listen_host: String,
    pub listen_port: Option<u16>,
    pub message: String,
    pub dev_external: bool,
    /// Last apoptosis crumb path (if written).
    pub last_crumb_path: Option<String>,
    /// Short crumb summary for splash crash UI.
    pub last_crumb_summary: Option<String>,
    pub show_restart: bool,
}

impl BootState {
    pub fn new(dev_external: bool) -> Self {
        Self {
            stage: BootStage::Paths,
            listen_host: "127.0.0.1".into(),
            listen_port: None,
            message: BootStage::Paths.splash_message().into(),
            dev_external,
            last_crumb_path: None,
            last_crumb_summary: None,
            show_restart: false,
        }
    }

    pub fn set_stage(&mut self, stage: BootStage) {
        self.stage = stage;
        self.message = stage.splash_message().into();
        self.show_restart = stage.show_restart();
    }

    pub fn set_error(&mut self, message: impl Into<String>) {
        self.stage = BootStage::Error;
        self.message = message.into();
        self.show_restart = true;
    }

    pub fn set_crumb(&mut self, path: Option<String>, summary: Option<String>) {
        self.last_crumb_path = path;
        self.last_crumb_summary = summary;
    }

    pub fn backend_url(&self) -> Option<String> {
        self.listen_port
            .map(|port| format!("http://{}:{}", self.listen_host, port))
    }
}

/// Snapshot pushed to splash via eval / invoke.
#[derive(Debug, Clone, Serialize)]
pub struct BootSnapshot {
    pub stage: String,
    pub message: String,
    pub show_restart: bool,
    pub last_crumb_summary: Option<String>,
    pub listen_port: Option<u16>,
    pub backend_url: Option<String>,
}

impl From<&BootState> for BootSnapshot {
    fn from(boot: &BootState) -> Self {
        Self {
            stage: boot.stage.label().into(),
            message: boot.message.clone(),
            show_restart: boot.show_restart,
            last_crumb_summary: boot.last_crumb_summary.clone(),
            listen_port: boot.listen_port,
            backend_url: boot.backend_url(),
        }
    }
}

/// Default listen range from `versions.lock.json` / ARCHITECTURE.
pub const PORT_RANGE: std::ops::RangeInclusive<u16> = 7860..=7870;
pub const DEFAULT_PORT: u16 = 7860;

/// Health poll until READY.
/// Cold Windows first-boot (imports + SQLite + component index) can exceed 5 minutes;
/// a prior 300s deadline caused false health_timeout kills mid-lifespan.
pub const HEALTH_TIMEOUT_SECS: u64 = 600;
pub const HEALTH_POLL_INTERVAL_MS: u64 = 500;

/// Heartbeat while Running.
pub const HEARTBEAT_INTERVAL_MS: u64 = 2_000;
pub const HEARTBEAT_MISS_LIMIT: u32 = 5;
