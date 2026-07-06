//! Recorder commands — device listing and the session lifecycle
//! (start / pause / resume / stop / cancel).
//!
//! Pure logic (arg builders, parsers) lives in `crate::recorder`; this module
//! owns the ffmpeg processes and the `record:state` event stream the frontend
//! HUD subscribes to.

use crate::recorder::{
    build_concat_manifest, build_ffmpeg_args, concat_args, parse_avfoundation_devices,
    RecordMode, RecordOptions, RecordingDevices,
};
use crate::recording_state::ActiveSession;
use crate::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::fs;
use tokio::time::sleep;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStatePayload {
    /// "recording" | "paused" | "finalizing" | "idle"
    pub state: &'static str,
    pub elapsed_sec: f64,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub path: String,
    pub duration_sec: f64,
    pub mode: String,
}

fn emit_state(app: &AppHandle, state: &'static str, elapsed: f64, mode: &RecordMode) {
    let _ = app.emit(
        "record:state",
        RecordStatePayload {
            state,
            elapsed_sec: elapsed,
            mode: mode.as_str().to_string(),
        },
    );
}

// ---------------------------------------------------------------------------
// Device enumeration
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_recording_devices(app: AppHandle) -> Result<RecordingDevices, String> {
    let shell = app.shell();
    let cmd = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not available: {e}"))?
        .args(["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);

    // ffmpeg exits non-zero after listing devices; the listing itself is on
    // stderr, so we collect it and ignore the exit code.
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("run ffmpeg device listing: {e}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let devices = parse_avfoundation_devices(&stderr);
    if devices.video.is_empty() && devices.audio.is_empty() {
        return Err(format!(
            "no capture devices found — ffmpeg said: {}",
            stderr.trim().chars().take(400).collect::<String>()
        ));
    }
    Ok(devices)
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async fn spawn_segment(
    app: &AppHandle,
    opts: &RecordOptions,
    path: &Path,
) -> Result<CommandChild, String> {
    let args = build_ffmpeg_args(opts, path)?;
    let shell = app.shell();
    let cmd = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not available: {e}"))?
        .args(args);
    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn ffmpeg: {e}"))?;

    let app_for_task = app.clone();
    let path_for_task = path.to_path_buf();
    tauri::async_runtime::spawn(async move {
        let mut stderr_tail = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    stderr_tail.push_str(&line);
                    stderr_tail.push('\n');
                    if stderr_tail.len() > 4000 {
                        let cut = stderr_tail.len() - 4000;
                        stderr_tail.drain(..cut);
                    }
                }
                CommandEvent::Terminated(t) => {
                    // `q` (pause/stop) exits 0 or 255 depending on timing; both fine.
                    if !matches!(t.code, Some(0) | Some(255)) {
                        log::warn!(
                            "recording ffmpeg exited with {:?} for {}: {}",
                            t.code,
                            path_for_task.display(),
                            stderr_tail
                        );
                        let _ = app_for_task.emit(
                            "record:error",
                            format!(
                                "Recording process ended unexpectedly. {}",
                                friendly_ffmpeg_error(&stderr_tail)
                            ),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

/// Distil ffmpeg's stderr into an actionable one-liner.
fn friendly_ffmpeg_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("operation not permitted") || lower.contains("not authorized") {
        return "Check Screen Recording / Camera / Microphone permission for YusafCut in \
                System Settings → Privacy & Security."
            .into();
    }
    stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Wait until ffmpeg has flushed the segment (size non-zero and stable).
async fn wait_for_flush(path: &Path) {
    let mut last: u64 = 0;
    for _ in 0..30 {
        sleep(Duration::from_millis(120)).await;
        let size = fs::metadata(path).await.map(|m| m.len()).unwrap_or(0);
        if size > 0 && size == last {
            return;
        }
        last = size;
    }
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: RecordOptions,
) -> Result<(), String> {
    let mut guard = state.recording.session.lock().await;
    if guard.is_some() {
        return Err("a recording is already running".into());
    }

    let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    dir.push("recordings");
    dir.push(format!("rec-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let seg_path = dir.join(format!("seg-000.{}", opts.mode.extension()));
    let child = spawn_segment(&app, &opts, &seg_path).await?;

    emit_state(&app, "recording", 0.0, &opts.mode);
    *guard = Some(ActiveSession {
        opts,
        dir,
        segments: vec![seg_path],
        child: Some(child),
        accumulated_secs: 0.0,
        segment_started: Some(Instant::now()),
    });
    drop(guard);

    // 1 Hz elapsed-time ticker for the HUD; exits when the session ends.
    let session = state.recording.session.clone();
    let app_for_tick = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(1)).await;
            let guard = session.lock().await;
            match guard.as_ref() {
                Some(s) => {
                    let state = if s.is_paused() { "paused" } else { "recording" };
                    emit_state(&app_for_tick, state, s.elapsed_secs(), &s.opts.mode);
                }
                None => break,
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn pause_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.recording.session.lock().await;
    let session = guard.as_mut().ok_or("no recording is running")?;
    let mut child = session.child.take().ok_or("recording is already paused")?;
    child
        .write(b"q")
        .map_err(|e| format!("failed to pause recording: {e}"))?;
    if let Some(started) = session.segment_started.take() {
        session.accumulated_secs += started.elapsed().as_secs_f64();
    }
    let (elapsed, mode) = (session.elapsed_secs(), session.opts.mode);
    if let Some(last) = session.segments.last().cloned() {
        drop(guard);
        wait_for_flush(&last).await;
    }
    emit_state(&app, "paused", elapsed, &mode);
    Ok(())
}

#[tauri::command]
pub async fn resume_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.recording.session.lock().await;
    let session = guard.as_mut().ok_or("no recording is running")?;
    if session.child.is_some() {
        return Err("recording is not paused".into());
    }
    let seg_path = session.dir.join(format!(
        "seg-{:03}.{}",
        session.segments.len(),
        session.opts.mode.extension()
    ));
    let child = spawn_segment(&app, &session.opts, &seg_path).await?;
    session.segments.push(seg_path);
    session.child = Some(child);
    session.segment_started = Some(Instant::now());
    emit_state(&app, "recording", session.elapsed_secs(), &session.opts.mode);
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RecordingResult, String> {
    let mut session = {
        let mut guard = state.recording.session.lock().await;
        guard.take().ok_or("no recording is running")?
    };

    if let Some(mut child) = session.child.take() {
        let _ = child.write(b"q");
        if let Some(started) = session.segment_started.take() {
            session.accumulated_secs += started.elapsed().as_secs_f64();
        }
    }
    emit_state(&app, "finalizing", session.accumulated_secs, &session.opts.mode);
    if let Some(last) = session.segments.last() {
        wait_for_flush(last).await;
    }

    // Drop zero-byte segments (e.g. a segment that never got a frame).
    let mut usable: Vec<PathBuf> = Vec::new();
    for seg in &session.segments {
        if fs::metadata(seg).await.map(|m| m.len()).unwrap_or(0) > 0 {
            usable.push(seg.clone());
        }
    }
    if usable.is_empty() {
        let _ = fs::remove_dir_all(&session.dir).await;
        emit_state(&app, "idle", 0.0, &session.opts.mode);
        return Err("recording produced no data — check capture permissions".into());
    }

    let ext = session.opts.mode.extension();
    let final_path = session
        .dir
        .join(format!("{}-{}.{ext}", session.opts.mode.as_str(), Uuid::new_v4()));

    if usable.len() == 1 {
        fs::rename(&usable[0], &final_path)
            .await
            .map_err(|e| format!("finalize recording: {e}"))?;
    } else {
        let manifest_path = session.dir.join("concat.txt");
        fs::write(&manifest_path, build_concat_manifest(&usable))
            .await
            .map_err(|e| e.to_string())?;
        let shell = app.shell();
        let cmd = shell
            .sidecar("ffmpeg")
            .map_err(|e| format!("ffmpeg sidecar not available: {e}"))?
            .args(concat_args(&manifest_path, &final_path));
        let output = cmd.output().await.map_err(|e| format!("concat segments: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "failed to join recording segments: {}",
                String::from_utf8_lossy(&output.stderr)
                    .lines()
                    .rev()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("")
            ));
        }
        for seg in &usable {
            let _ = fs::remove_file(seg).await;
        }
        let _ = fs::remove_file(&manifest_path).await;
    }

    emit_state(&app, "idle", 0.0, &session.opts.mode);
    Ok(RecordingResult {
        path: final_path.to_string_lossy().into_owned(),
        duration_sec: session.accumulated_secs,
        mode: session.opts.mode.as_str().to_string(),
    })
}

#[tauri::command]
pub async fn cancel_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let session = {
        let mut guard = state.recording.session.lock().await;
        guard.take().ok_or("no recording is running")?
    };
    let mode = session.opts.mode;
    if let Some(child) = session.child {
        let _ = child.kill();
    }
    // Give ffmpeg a beat to die before deleting its output directory.
    sleep(Duration::from_millis(200)).await;
    let _ = fs::remove_dir_all(&session.dir).await;
    emit_state(&app, "idle", 0.0, &mode);
    Ok(())
}
