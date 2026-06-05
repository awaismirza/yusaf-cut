//! Pause / silence detection command.
//!
//! Runs `ffmpeg -af silencedetect` on the source media and parses its stderr
//! to produce a list of silent ranges.  The frontend renders each range as an
//! inline `[0.6s]` badge in the transcript and can optionally cut ranges from
//! the EDL.
//!
//! Each `PauseSegment` carries a stable UUID so the frontend can track,
//! delete, or shorten individual pauses without relying on fragile float
//! equality checks.

use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A single contiguous silence detected in the source media.
#[derive(Debug, Serialize, Clone)]
pub struct PauseSegment {
    /// Stable UUID assigned at detection time.  Used by the frontend to track
    /// individual pauses without float comparisons.
    pub id: String,
    /// Start of the silent range in source-media seconds.
    pub start: f64,
    /// End of the silent range in source-media seconds.
    pub end: f64,
    /// `end - start` — pre-computed so the frontend never has to subtract.
    pub duration: f64,
}

/// Options for the `detect_pauses` command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectPausesOpts {
    /// Absolute path to the video or audio file.
    pub media_path: String,
    /// Noise floor in dB (negative).  Samples below this level are considered
    /// silent.  Default –35 dB is conservative enough for most speech.
    #[serde(default = "default_noise_threshold")]
    pub noise_threshold: f64,
    /// Minimum silence length in seconds for a gap to be reported.
    #[serde(default = "default_min_duration")]
    pub min_duration: f64,
}

fn default_noise_threshold() -> f64 {
    -35.0
}
fn default_min_duration() -> f64 {
    0.5
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// Detect silent ranges in a media file using `ffmpeg silencedetect`.
///
/// Returns a vector of `PauseSegment` entries in detection order (roughly
/// chronological).  An empty vector means no silences longer than
/// `minDuration` were found.
#[tauri::command]
pub async fn detect_pauses(
    app: AppHandle,
    _state: State<'_, AppState>,
    opts: DetectPausesOpts,
) -> Result<Vec<PauseSegment>, String> {
    let shell = app.shell();

    let af = format!(
        "silencedetect=noise={}dB:d={}",
        opts.noise_threshold, opts.min_duration
    );

    let (mut rx, _child) = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not available: {e}"))?
        .args([
            "-i",
            &opts.media_path,
            "-vn",
            "-af",
            &af,
            "-hide_banner",
            "-f",
            "null",
            "-",
        ])
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;

    let mut stderr_buf = String::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(buf) => {
                stderr_buf.push_str(&String::from_utf8_lossy(&buf));
            }
            CommandEvent::Terminated(status) => {
                exit_code = status.code;
                break;
            }
            _ => {}
        }
    }

    match exit_code {
        Some(0) | None => Ok(parse_silence_output(&stderr_buf)),
        Some(code) => Err(format!("ffmpeg exited with code {code}: {stderr_buf}")),
    }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/// Parse ffmpeg silencedetect stderr into `PauseSegment` entries.
///
/// Expected line formats (from ffmpeg's lavfi/silencedetect.c):
///   `[silencedetect @ …] silence_start: 1.234`
///   `[silencedetect @ …] silence_end: 2.567 | silence_duration: 1.333`
///
/// Segments where `end <= start` are discarded as invalid.
/// A `silence_end` line with no matching `silence_start` is silently ignored.
fn parse_silence_output(stderr: &str) -> Vec<PauseSegment> {
    let mut pauses = Vec::new();
    let mut current_start: Option<f64> = None;

    for line in stderr.lines() {
        if let Some(pos) = line.find("silence_start: ") {
            if let Ok(t) = line[pos + 15..].trim().parse::<f64>() {
                current_start = Some(t);
            }
        } else if let Some(pos) = line.find("silence_end: ") {
            let rest = &line[pos + 13..];
            // silence_end may have " | silence_duration: …" suffix — take only the value.
            let end_str = rest.split('|').next().unwrap_or("").trim();
            if let (Some(start), Ok(end)) = (current_start.take(), end_str.parse::<f64>()) {
                if end > start {
                    let duration = end - start;
                    pauses.push(PauseSegment {
                        id: Uuid::new_v4().to_string(),
                        start,
                        end,
                        duration,
                    });
                }
                // If end <= start (invalid range) the segment is discarded.
            }
            // If current_start is None (no matching silence_start) we do nothing.
        }
    }

    pauses
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_typical_ffmpeg_output() {
        let stderr = "\
[silencedetect @ 0x600000a14000] silence_start: 0.535
[silencedetect @ 0x600000a14000] silence_end: 1.234 | silence_duration: 0.699
[silencedetect @ 0x600000a14000] silence_start: 5.1
[silencedetect @ 0x600000a14000] silence_end: 7.8 | silence_duration: 2.7
";
        let pauses = parse_silence_output(stderr);
        assert_eq!(pauses.len(), 2);
        assert!((pauses[0].start - 0.535).abs() < 1e-6);
        assert!((pauses[0].end - 1.234).abs() < 1e-6);
        assert!((pauses[0].duration - 0.699).abs() < 1e-4);
        assert!(!pauses[0].id.is_empty());
        assert!((pauses[1].start - 5.1).abs() < 1e-6);
        assert!((pauses[1].end - 7.8).abs() < 1e-6);
        // Each pause gets a unique ID
        assert_ne!(pauses[0].id, pauses[1].id);
    }

    #[test]
    fn returns_empty_on_no_silence() {
        let stderr = "some other ffmpeg output without silence lines";
        assert!(parse_silence_output(stderr).is_empty());
    }

    #[test]
    fn ignores_malformed_lines() {
        let stderr = "\
silence_start: not_a_number
silence_end: also_not_a_number | silence_duration: 0.0
[noise] silence_start: 1.0
[noise] silence_end: abc | silence_duration: 0.0
";
        // None of the values parse to f64, so result is empty.
        assert!(parse_silence_output(stderr).is_empty());
    }

    #[test]
    fn silence_end_without_silence_start_is_ignored() {
        let stderr = "\
[silencedetect @ 0x1] silence_end: 2.0 | silence_duration: 1.0
[silencedetect @ 0x1] silence_start: 3.0
[silencedetect @ 0x1] silence_end: 4.0 | silence_duration: 1.0
";
        // The first silence_end has no preceding start — it is dropped.
        let pauses = parse_silence_output(stderr);
        assert_eq!(pauses.len(), 1);
        assert!((pauses[0].start - 3.0).abs() < 1e-6);
        assert!((pauses[0].end - 4.0).abs() < 1e-6);
    }

    #[test]
    fn rejects_invalid_range_where_end_le_start() {
        let stderr = "\
[silencedetect @ 0x1] silence_start: 5.0
[silencedetect @ 0x1] silence_end: 5.0 | silence_duration: 0.0
[silencedetect @ 0x1] silence_start: 6.0
[silencedetect @ 0x1] silence_end: 4.0 | silence_duration: -2.0
";
        // Both are invalid (end == start and end < start).
        assert!(parse_silence_output(stderr).is_empty());
    }
}
