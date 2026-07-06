//! Shared state for an active recorder session (see `commands::record`).

use crate::recorder::RecordOptions;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri_plugin_shell::process::CommandChild;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct RecordingState {
    pub session: Arc<Mutex<Option<ActiveSession>>>,
}

/// One recorder session — possibly spanning several ffmpeg segment files
/// (each pause/resume boundary starts a new segment; stop concatenates them).
pub struct ActiveSession {
    pub opts: RecordOptions,
    /// Session directory under `<app-data>/recordings/`.
    pub dir: PathBuf,
    /// Completed segment files, in order.
    pub segments: Vec<PathBuf>,
    /// The ffmpeg process currently writing `segments.last()`, when recording.
    pub child: Option<CommandChild>,
    /// Seconds of footage captured by *completed* segments.
    pub accumulated_secs: f64,
    /// Wall-clock start of the currently-recording segment.
    pub segment_started: Option<Instant>,
}

impl ActiveSession {
    pub fn elapsed_secs(&self) -> f64 {
        self.accumulated_secs
            + self
                .segment_started
                .map(|t| t.elapsed().as_secs_f64())
                .unwrap_or(0.0)
    }

    pub fn is_paused(&self) -> bool {
        self.child.is_none()
    }
}
