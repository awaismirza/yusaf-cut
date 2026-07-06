//! Recorder — pure logic for the in-app screen/camera/voice recorder.
//!
//! Everything here is side-effect free (arg builders, parsers, manifest
//! generation) so it can be unit-tested without spawning ffmpeg. The actual
//! process management lives in `commands::record`.

use serde::{Deserialize, Serialize};
use std::path::Path;

// ---------------------------------------------------------------------------
// Device enumeration
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoDevice {
    pub index: u32,
    pub name: String,
    pub is_screen: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub index: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingDevices {
    pub video: Vec<VideoDevice>,
    pub audio: Vec<AudioDevice>,
}

/// Parse the stderr of `ffmpeg -f avfoundation -list_devices true -i ""`.
///
/// The listing looks like:
/// ```text
/// [AVFoundation indev @ 0x...] AVFoundation video devices:
/// [AVFoundation indev @ 0x...] [0] FaceTime HD Camera
/// [AVFoundation indev @ 0x...] [1] Capture screen 0
/// [AVFoundation indev @ 0x...] AVFoundation audio devices:
/// [AVFoundation indev @ 0x...] [0] MacBook Pro Microphone
/// ```
pub fn parse_avfoundation_devices(stderr: &str) -> RecordingDevices {
    #[derive(PartialEq)]
    enum Section {
        None,
        Video,
        Audio,
    }
    let mut section = Section::None;
    let mut out = RecordingDevices::default();

    for line in stderr.lines() {
        if line.contains("AVFoundation video devices") {
            section = Section::Video;
            continue;
        }
        if line.contains("AVFoundation audio devices") {
            section = Section::Audio;
            continue;
        }
        if section == Section::None {
            continue;
        }
        // Device lines end with `] [<idx>] <name>` — take the *last* bracket pair.
        let Some((idx, name)) = parse_device_line(line) else {
            continue;
        };
        match section {
            Section::Video => out.video.push(VideoDevice {
                index: idx,
                is_screen: name.starts_with("Capture screen"),
                name,
            }),
            Section::Audio => out.audio.push(AudioDevice { index: idx, name }),
            Section::None => {}
        }
    }
    out
}

fn parse_device_line(line: &str) -> Option<(u32, String)> {
    // Take the FIRST `[digits]` pair as the device index — the log prefix
    // (`[AVFoundation indev @ 0x…]`) never parses as pure digits, and device
    // names may themselves contain bracketed numbers further right.
    let mut found: Option<(u32, usize)> = None;
    let mut i = 0;
    while let Some(open_rel) = line[i..].find('[') {
        let open = i + open_rel;
        let Some(close_rel) = line[open..].find(']') else {
            break;
        };
        let close_abs = open + close_rel;
        let inner = &line[open + 1..close_abs];
        if !inner.is_empty() && inner.bytes().all(|b| b.is_ascii_digit()) {
            found = Some((inner.parse().ok()?, close_abs));
            break;
        }
        i = close_abs + 1;
    }
    let (idx, name_start) = found?;
    let name = line[name_start + 1..].trim();
    if name.is_empty() {
        return None;
    }
    Some((idx, name.to_string()))
}

// ---------------------------------------------------------------------------
// Recording options + ffmpeg argument builder
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecordMode {
    Screen,
    ScreenCamera,
    Camera,
    Voiceover,
}

impl RecordMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            RecordMode::Screen => "screen",
            RecordMode::ScreenCamera => "screen-camera",
            RecordMode::Camera => "camera",
            RecordMode::Voiceover => "voiceover",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            RecordMode::Voiceover => "m4a",
            _ => "mp4",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PipCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PipSize {
    Small,
    Medium,
    Large,
}

impl PipSize {
    /// Webcam bubble width as a fraction of the main (screen) width.
    fn fraction(&self) -> f32 {
        match self {
            PipSize::Small => 0.18,
            PipSize::Medium => 0.25,
            PipSize::Large => 0.33,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordOptions {
    pub mode: RecordMode,
    /// avfoundation video index of the screen to capture.
    pub screen_index: Option<u32>,
    /// avfoundation video index of the camera.
    pub camera_index: Option<u32>,
    /// avfoundation audio index of the microphone. `None` disables audio.
    pub audio_index: Option<u32>,
    pub fps: Option<u32>,
    pub pip_corner: Option<PipCorner>,
    pub pip_size: Option<PipSize>,
}

const PIP_MARGIN: u32 = 28;

/// Build the full ffmpeg argument list for one recording segment.
pub fn build_ffmpeg_args(opts: &RecordOptions, output: &Path) -> Result<Vec<String>, String> {
    let fps = opts.fps.unwrap_or(30).clamp(10, 60).to_string();
    let audio = opts
        .audio_index
        .map(|i| i.to_string())
        .unwrap_or_else(|| "none".into());
    let mut args: Vec<String> = vec!["-y".into(), "-hide_banner".into()];

    match opts.mode {
        RecordMode::Screen | RecordMode::ScreenCamera => {
            let screen = opts
                .screen_index
                .ok_or("screen recording requires a screen device")?;
            args.extend([
                "-f".into(),
                "avfoundation".into(),
                "-framerate".into(),
                fps.clone(),
                "-capture_cursor".into(),
                "1".into(),
                "-capture_mouse_clicks".into(),
                "1".into(),
                "-i".into(),
                format!("{screen}:{audio}"),
            ]);

            if opts.mode == RecordMode::ScreenCamera {
                let camera = opts
                    .camera_index
                    .ok_or("screen + camera recording requires a camera device")?;
                args.extend([
                    "-f".into(),
                    "avfoundation".into(),
                    "-framerate".into(),
                    fps.clone(),
                    "-i".into(),
                    format!("{camera}:none"),
                ]);
                args.extend(["-filter_complex".into(), pip_filter(opts)]);
            }

            args.extend([
                "-c:v".into(),
                "h264_videotoolbox".into(),
                "-b:v".into(),
                "8000k".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if opts.audio_index.is_some() {
                args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
            }
        }
        RecordMode::Camera => {
            let camera = opts
                .camera_index
                .ok_or("camera recording requires a camera device")?;
            args.extend([
                "-f".into(),
                "avfoundation".into(),
                "-framerate".into(),
                fps.clone(),
                "-i".into(),
                format!("{camera}:{audio}"),
                "-c:v".into(),
                "h264_videotoolbox".into(),
                "-b:v".into(),
                "6000k".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
            if opts.audio_index.is_some() {
                args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
            }
        }
        RecordMode::Voiceover => {
            if opts.audio_index.is_none() {
                return Err("voice-over recording requires a microphone".into());
            }
            args.extend([
                "-f".into(),
                "avfoundation".into(),
                "-i".into(),
                format!(":{audio}"),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "192k".into(),
            ]);
        }
    }

    // Fragmented-friendly flags so an interrupted segment is still salvageable.
    if opts.mode != RecordMode::Voiceover {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(output.to_string_lossy().into_owned());
    Ok(args)
}

/// filter_complex string compositing the camera into a corner of the screen.
fn pip_filter(opts: &RecordOptions) -> String {
    let frac = opts.pip_size.unwrap_or(PipSize::Medium).fraction();
    let m = PIP_MARGIN;
    let (x, y) = match opts.pip_corner.unwrap_or(PipCorner::BottomRight) {
        PipCorner::TopLeft => (format!("{m}"), format!("{m}")),
        PipCorner::TopRight => (format!("main_w-overlay_w-{m}"), format!("{m}")),
        PipCorner::BottomLeft => (format!("{m}"), format!("main_h-overlay_h-{m}")),
        PipCorner::BottomRight => (
            format!("main_w-overlay_w-{m}"),
            format!("main_h-overlay_h-{m}"),
        ),
    };
    // scale2ref sizes the camera relative to the screen; iw/ih are the camera's
    // own dimensions, main_w the screen's. Widths are forced even for yuv420p.
    format!(
        "[1:v][0:v]scale2ref=w='trunc(main_w*{frac}/2)*2':h='trunc(main_w*{frac}*ih/iw/2)*2'[cam][scr];[scr][cam]overlay={x}:{y}"
    )
}

// ---------------------------------------------------------------------------
// Segment concat
// ---------------------------------------------------------------------------

/// Manifest for ffmpeg's concat demuxer. Paths are single-quoted with
/// embedded quotes escaped per ffmpeg's `'\''` convention.
pub fn build_concat_manifest(segments: &[std::path::PathBuf]) -> String {
    let mut out = String::new();
    for seg in segments {
        let path = seg.to_string_lossy().replace('\'', "'\\''");
        out.push_str(&format!("file '{path}'\n"));
    }
    out
}

pub fn concat_args(manifest: &Path, output: &Path) -> Vec<String> {
    vec![
        "-y".into(),
        "-hide_banner".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        manifest.to_string_lossy().into_owned(),
        "-c".into(),
        "copy".into(),
        output.to_string_lossy().into_owned(),
    ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const SAMPLE: &str = "\
[AVFoundation indev @ 0x7f8] AVFoundation video devices:
[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7f8] [1] OBS Virtual Camera
[AVFoundation indev @ 0x7f8] [2] Capture screen 0
[AVFoundation indev @ 0x7f8] [3] Capture screen 1
[AVFoundation indev @ 0x7f8] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x7f8] [1] External USB Mic [2]
: Input/output error";

    #[test]
    fn parses_video_and_audio_sections() {
        let d = parse_avfoundation_devices(SAMPLE);
        assert_eq!(d.video.len(), 4);
        assert_eq!(d.audio.len(), 2);
        assert_eq!(d.video[0].name, "FaceTime HD Camera");
        assert!(!d.video[0].is_screen);
        assert!(d.video[2].is_screen);
        assert_eq!(d.video[3].name, "Capture screen 1");
        assert_eq!(d.audio[0].name, "MacBook Pro Microphone");
    }

    #[test]
    fn device_name_containing_brackets_keeps_full_name() {
        // "[1] External USB Mic [2]" — the trailing "[2]" is part of the name.
        let d = parse_avfoundation_devices(SAMPLE);
        assert_eq!(d.audio[1].index, 1);
        assert_eq!(d.audio[1].name, "External USB Mic [2]");
    }

    #[test]
    fn screen_args_include_cursor_capture_and_audio() {
        let opts = RecordOptions {
            mode: RecordMode::Screen,
            screen_index: Some(2),
            camera_index: None,
            audio_index: Some(0),
            fps: None,
            pip_corner: None,
            pip_size: None,
        };
        let args = build_ffmpeg_args(&opts, Path::new("/tmp/seg-000.mp4")).unwrap();
        let joined = args.join(" ");
        assert!(joined.contains("-i 2:0"));
        assert!(joined.contains("-capture_cursor 1"));
        assert!(joined.contains("h264_videotoolbox"));
        assert!(joined.contains("-c:a aac"));
    }

    #[test]
    fn screen_without_mic_omits_audio_codec() {
        let opts = RecordOptions {
            mode: RecordMode::Screen,
            screen_index: Some(1),
            camera_index: None,
            audio_index: None,
            fps: Some(60),
            pip_corner: None,
            pip_size: None,
        };
        let args = build_ffmpeg_args(&opts, Path::new("/tmp/s.mp4")).unwrap();
        let joined = args.join(" ");
        assert!(joined.contains("-i 1:none"));
        assert!(!joined.contains("-c:a"));
        assert!(joined.contains("-framerate 60"));
    }

    #[test]
    fn screen_camera_builds_pip_overlay() {
        let opts = RecordOptions {
            mode: RecordMode::ScreenCamera,
            screen_index: Some(2),
            camera_index: Some(0),
            audio_index: Some(0),
            fps: None,
            pip_corner: Some(PipCorner::TopLeft),
            pip_size: Some(PipSize::Small),
        };
        let args = build_ffmpeg_args(&opts, Path::new("/tmp/s.mp4")).unwrap();
        let joined = args.join(" ");
        assert!(joined.contains("-filter_complex"));
        assert!(joined.contains("overlay=28:28"));
        assert!(joined.contains("scale2ref"));
        // Two avfoundation inputs
        assert_eq!(joined.matches("avfoundation").count(), 2);
    }

    #[test]
    fn voiceover_is_audio_only() {
        let opts = RecordOptions {
            mode: RecordMode::Voiceover,
            screen_index: None,
            camera_index: None,
            audio_index: Some(1),
            fps: None,
            pip_corner: None,
            pip_size: None,
        };
        let args = build_ffmpeg_args(&opts, Path::new("/tmp/v.m4a")).unwrap();
        let joined = args.join(" ");
        assert!(joined.contains("-i :1"));
        assert!(!joined.contains("videotoolbox"));
    }

    #[test]
    fn missing_required_device_errors() {
        let opts = RecordOptions {
            mode: RecordMode::Screen,
            screen_index: None,
            camera_index: None,
            audio_index: None,
            fps: None,
            pip_corner: None,
            pip_size: None,
        };
        assert!(build_ffmpeg_args(&opts, Path::new("/tmp/x.mp4")).is_err());
    }

    #[test]
    fn concat_manifest_escapes_quotes() {
        let segs = vec![
            PathBuf::from("/tmp/a/seg-000.mp4"),
            PathBuf::from("/tmp/it's/seg-001.mp4"),
        ];
        let m = build_concat_manifest(&segs);
        assert_eq!(
            m,
            "file '/tmp/a/seg-000.mp4'\nfile '/tmp/it'\\''s/seg-001.mp4'\n"
        );
    }
}
