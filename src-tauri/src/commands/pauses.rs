//! Pause / silence detection command.
//!
//! Runs `ffmpeg -af silencedetect` on the source media and parses its stderr
//! to produce a list of silent ranges.  The frontend can then render each
//! range as an inline `[0.6s]` badge in the transcript and optionally cut
//! those ranges from the EDL.

use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A single contiguous silence detected in the source media.
#[derive(Debug, Serialize)]
pub struct PauseSegment {
    pub start: f64,
    pub end: f64,
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
/// Returns a vector of `PauseSegment` entries sorted by `start` time.
/// An empty vector means no silences longer than `minDuration` were found.
#[tauri::command]
pub async fn detect_pauses(
    app: AppHandle,
    _state: State<'_, AppState>,
    opts: DetectPausesOpts,
) -> Result<Vec<PauseSegment>, String> {
    let shell = app.shell();

    // silencedetect filter: noise floor + minimum silence duration
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
            "-vn",            // drop video stream — we only need audio analysis
            "-af",
            &af,
            "-hide_banner",
            "-f",
            "null",
            "-",              // null muxer output — all useful info comes via stderr
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
            // silence_end line may have " | silence_duration: …" suffix — take only the value
            let end_str = rest.split('|').next().unwrap_or("").trim();
            if let (Some(start), Ok(end)) = (current_start.take(), end_str.parse::<f64>()) {
                pauses.push(PauseSegment { start, end });
            }
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
        assert!((pauses[1].start - 5.1).abs() < 1e-6);
        assert!((pauses[1].end - 7.8).abs() < 1e-6);
    }

    #[test]
    fn returns_empty_on_no_silence() {
        let stderr = "some other output without silence lines";
        assert!(parse_silence_output(stderr).is_empty());
    }
}
