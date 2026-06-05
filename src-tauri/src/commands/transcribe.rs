//! Transcription commands:
//!   - `transcribe`     — extract 16kHz mono WAV, run whisper-cli, parse JSON, emit progress
//!   - `list_models`    — what is installed locally, what needs downloading
//!   - `download_model` — fetch a model from Hugging Face
//!
//! Only whisper.cpp is supported (via the `whisper-cli` sidecar with Core ML + Metal).
//! WhisperKit was removed in v3.2.0 — restore from commit 4726d25 if needed.
//!
//! Progress events are emitted on the channel `transcribe:progress` and
//! `model:download:progress`. Frontend subscribes via `ipc.ts`.

use crate::AppState;
use crate::edl::Word;
use crate::jobs::JobKind;
use crate::transcribe::parse_whisper_json;
use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tokio::fs;
use tokio::io::AsyncWriteExt as _;

// ---------------------------------------------------------------------------
// TranscriptionEngine
// ---------------------------------------------------------------------------

/// Transcription backend. whisper.cpp only since v3.2.0.
///
/// WhisperKit was removed because ANE-quantized models produced less accurate
/// word timestamps, causing video/text drift. To restore it, see commit 4726d25.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptionEngine {
    #[default]
    WhisperCpp,
}

// ---------------------------------------------------------------------------
// WhisperModel (whisper.cpp / GGML)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WhisperModel {
    Tiny,
    Base,
    Small,
    Medium,
    #[serde(rename = "large-v3-turbo")]
    LargeV3Turbo,
    /// Full large-v3 (non-turbo). Highest accuracy, ~3.1 GB. Receives DTW refinement.
    #[serde(rename = "large-v3")]
    LargeV3,
}

impl WhisperModel {
    pub fn filename(self) -> &'static str {
        match self {
            WhisperModel::Tiny => "ggml-tiny.bin",
            WhisperModel::Base => "ggml-base.bin",
            WhisperModel::Small => "ggml-small.bin",
            WhisperModel::Medium => "ggml-medium.bin",
            WhisperModel::LargeV3Turbo => "ggml-large-v3-turbo.bin",
            WhisperModel::LargeV3 => "ggml-large-v3.bin",
        }
    }

    /// Base name used in Core ML encoder filenames, e.g. "tiny", "large-v3-turbo".
    pub fn base_name(self) -> &'static str {
        match self {
            WhisperModel::Tiny => "tiny",
            WhisperModel::Base => "base",
            WhisperModel::Small => "small",
            WhisperModel::Medium => "medium",
            WhisperModel::LargeV3Turbo => "large-v3-turbo",
            WhisperModel::LargeV3 => "large-v3",
        }
    }

    /// The Core ML encoder directory that whisper-cli looks for next to the .bin.
    /// e.g. "ggml-tiny-encoder.mlmodelc"
    pub fn coreml_encoder_dir(self) -> String {
        format!("ggml-{}-encoder.mlmodelc", self.base_name())
    }

    /// The zip file name on HuggingFace that contains the Core ML encoder.
    pub fn coreml_encoder_zip(self) -> String {
        format!("ggml-{}-encoder.mlmodelc.zip", self.base_name())
    }

    pub fn size_mb(self) -> u64 {
        match self {
            WhisperModel::Tiny => 75,
            WhisperModel::Base => 142,
            WhisperModel::Small => 466,
            WhisperModel::Medium => 1500,
            WhisperModel::LargeV3Turbo => 1600,
            WhisperModel::LargeV3 => 3100,
        }
    }
}

// ---------------------------------------------------------------------------
// Shared ModelInfo (returned by list_models)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ModelInfo {
    pub engine: TranscriptionEngine,
    pub name: String,
    #[serde(rename = "sizeMb")]
    pub size_mb: u64,
    pub installed: bool,
}

// ---------------------------------------------------------------------------
// TranscribeOpts / TranscribeResult / TranscribeProgress
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct TranscribeOpts {
    #[serde(rename = "mediaId")]
    pub media_id: String,
    #[serde(rename = "mediaPath")]
    pub media_path: String,
    /// Always "whisper-cpp" since v3.2.0.
    #[serde(rename = "engine", default)]
    pub engine: TranscriptionEngine,
    /// WhisperModel slug in kebab-case, e.g. "large-v3-turbo".
    #[serde(rename = "modelName")]
    pub model_name: String,
    /// Total media duration in seconds — used to emit accurate 0..1 progress.
    #[serde(rename = "mediaDuration", default)]
    pub media_duration: f64,
    /// BCP-47 language code. `None` / omitted → Whisper auto-detects.
    #[serde(rename = "language", default)]
    pub language: Option<String>,
    /// Output English regardless of source language (`--translate`).
    #[serde(rename = "translate", default)]
    pub translate: bool,
    /// Attempt speaker diarisation (`--diarize`).
    #[serde(rename = "diarize", default)]
    pub diarize: bool,
}

#[derive(Debug, Serialize)]
pub struct TranscribeResult {
    #[serde(rename = "mediaId")]
    pub media_id: String,
    pub words: Vec<Word>,
    pub engine: TranscriptionEngine,
}

#[derive(Debug, Serialize, Clone)]
pub struct TranscribeProgress {
    #[serde(rename = "mediaId")]
    pub media_id: String,
    pub progress: f64,
    #[serde(rename = "currentTime")]
    pub current_time: f64,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut p = app.path().app_data_dir().map_err(|e| e.to_string())?;
    p.push("models");
    Ok(p)
}

// ---------------------------------------------------------------------------
// list_models  (whisper.cpp GGML only)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    let ggml_dir = models_dir(&app)?;
    let out = [
        WhisperModel::Tiny,
        WhisperModel::Base,
        WhisperModel::Small,
        WhisperModel::Medium,
        WhisperModel::LargeV3Turbo,
        WhisperModel::LargeV3,
    ]
    .iter()
    .map(|&m| ModelInfo {
        engine: TranscriptionEngine::WhisperCpp,
        name: serde_json::to_value(m)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default(),
        size_mb: m.size_mb(),
        installed: ggml_dir.join(m.filename()).exists(),
    })
    .collect();
    Ok(out)
}

// ---------------------------------------------------------------------------
// download_model  (GGML bin + Core ML encoder zip)
// ---------------------------------------------------------------------------

/// Download a single file from HuggingFace whisper.cpp repo, emitting progress
/// events with the given `progress_name` key.
///
/// `phase` / `label` are forwarded verbatim in the event so the frontend can
/// display a human-readable status (e.g. "Downloading model file" vs
/// "Downloading Core ML encoder").  `progress_scale` and `progress_offset`
/// map the raw 0–1 file progress into the caller's combined progress range.
async fn download_hf_file(
    app: &AppHandle,
    url: &str,
    dest: &PathBuf,
    progress_name: impl Serialize,
    progress_scale: f64,
    progress_offset: f64,
    phase: &str,
    label: &str,
) -> Result<(), String> {
    let tmp = dest.with_extension(format!(
        "{}.partial",
        dest.extension().unwrap_or_default().to_string_lossy()
    ));
    // Remove any stale partial left by a previously interrupted download.
    if tmp.exists() {
        let _ = fs::remove_file(&tmp).await;
    }

    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "download failed ({}): {}",
            dest.display(),
            resp.status()
        ));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut file = fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let raw = if total > 0 {
            downloaded as f64 / total as f64
        } else {
            0.0
        };
        let progress = (raw * progress_scale + progress_offset).clamp(0.0, 1.0);
        app.emit(
            "model:download:progress",
            serde_json::json!({
                "name": progress_name,
                "phase": phase,
                "label": label,
                "progress": progress,
                "bytesDownloaded": downloaded,
                "bytesTotal": total,
            }),
        )
        .ok();
    }

    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&tmp, dest).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Unzip a single-directory zip into `parent_dir`, then remove the zip.
async fn unzip_coreml_encoder(zip_path: &PathBuf, parent_dir: &PathBuf) -> Result<(), String> {
    let output = std::process::Command::new("unzip")
        .arg("-o")
        .arg(zip_path)
        .arg("-d")
        .arg(parent_dir)
        .output()
        .map_err(|e| format!("failed to run unzip: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("unzip failed: {stderr}"));
    }
    let _ = fs::remove_file(zip_path).await;
    Ok(())
}

/// Download a whisper.cpp GGML model (bin + optional Core ML encoder).
///
/// Combined progress weighting across the full operation:
///   0 %  → 75 %  — GGML .bin download          (phase: "model")
///  75 %  → 95 %  — Core ML encoder download     (phase: "coreml")
///  95 %  → 100 % — unzip / preparation          (phase: "unzip")
///        100 %   — complete                     (phase: "complete")
async fn download_whisper_cpp_model(
    app: &AppHandle,
    name: WhisperModel,
) -> Result<(), String> {
    let dir = models_dir(app)?;
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let bin_url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        name.filename()
    );
    let bin_dest = dir.join(name.filename());
    // .bin: combined 0 % → 75 %
    download_hf_file(app, &bin_url, &bin_dest, name, 0.75, 0.0, "model", "Downloading model file").await?;
    // Core ML encoder: combined 75 % → 95 % (download) + 95 % → 100 % (unzip)
    ensure_coreml_encoder(app, &dir, name, 0.75, 0.20).await;

    app.emit(
        "model:download:progress",
        serde_json::json!({
            "name": name,
            "phase": "complete",
            "label": "Model ready",
            "progress": 1.0,
            "bytesDownloaded": 0u64,
            "bytesTotal": 0u64,
        }),
    )
    .ok();

    Ok(())
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    state: State<'_, AppState>,
    engine: TranscriptionEngine,
    name: String,
) -> Result<(), String> {
    let job = state
        .jobs
        .create(
            &app,
            JobKind::DownloadModel,
            format!("Downloading model: {name}"),
        )
        .await;
    job.mark_running().await;

    // Only whisper-cpp is supported since v3.2.0.
    let _ = engine; // always WhisperCpp
    let model: WhisperModel = serde_json::from_value(serde_json::Value::String(name))
        .map_err(|e| format!("unknown model: {e}"))?;
    let result = download_whisper_cpp_model(&app, model).await;

    match &result {
        Ok(()) => job.mark_completed().await,
        Err(e) => job.mark_failed(e.clone()).await,
    }
    result
}

// ---------------------------------------------------------------------------
// delete_model  — remove downloaded GGML bin + Core ML encoder directory
// ---------------------------------------------------------------------------

/// Delete a downloaded whisper.cpp model and its associated Core ML encoder.
///
/// Missing files are silently ignored — only real filesystem errors are returned.
/// The `engine` argument is accepted for API consistency but always treated as
/// `WhisperCpp` (the only supported engine).
#[tauri::command]
pub async fn delete_model(
    app: AppHandle,
    _engine: TranscriptionEngine,
    name: String,
) -> Result<(), String> {
    let model: WhisperModel = serde_json::from_value(serde_json::Value::String(name))
        .map_err(|e| format!("unknown model: {e}"))?;

    let dir = models_dir(&app)?;

    // Remove the GGML binary (.bin).
    let bin_path = dir.join(model.filename());
    if bin_path.exists() {
        fs::remove_file(&bin_path)
            .await
            .map_err(|e| format!("failed to remove {}: {e}", bin_path.display()))?;
    }

    // Remove the Core ML encoder directory (.mlmodelc) if present.
    let encoder_dir = dir.join(model.coreml_encoder_dir());
    if encoder_dir.exists() {
        fs::remove_dir_all(&encoder_dir)
            .await
            .map_err(|e| format!("failed to remove {}: {e}", encoder_dir.display()))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// ensure_coreml_encoder — whisper.cpp Core ML companion (unchanged)
// ---------------------------------------------------------------------------

/// Ensure the Core ML encoder directory exists for `name`, downloading and
/// unzipping it if necessary.
///
/// `progress_offset` and `progress_scale` place this step inside the caller's
/// combined progress range.  The download occupies the first 90 % of
/// `progress_scale`; the unzip step occupies the remaining 10 %.
///
/// Returns `true` if the encoder is available (was already present or was
/// successfully installed), `false` on failure (CPU fallback will be used).
async fn ensure_coreml_encoder(
    app: &AppHandle,
    models: &PathBuf,
    name: WhisperModel,
    progress_offset: f64,
    progress_scale: f64,
) -> bool {
    let encoder_dir = models.join(name.coreml_encoder_dir());
    if encoder_dir.exists() {
        return true;
    }

    log::info!(
        "Core ML encoder missing for {} — downloading automatically",
        name.filename()
    );

    let zip_name = name.coreml_encoder_zip();
    let zip_dest = models.join(&zip_name);
    let zip_url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        zip_name
    );

    // Reserve the last 10 % of the allocated range for the unzip step.
    let dl_scale = progress_scale * 0.9;
    let unzip_progress = (progress_offset + dl_scale).clamp(0.0, 1.0);

    let ok = match download_hf_file(
        app,
        &zip_url,
        &zip_dest,
        name,
        dl_scale,
        progress_offset,
        "coreml",
        "Downloading Core ML encoder",
    )
    .await
    {
        Err(e) => {
            log::warn!("Core ML encoder download failed: {e}");
            // Emit a skipped event so the UI knows this phase ended and won't appear stuck.
            app.emit(
                "model:download:progress",
                serde_json::json!({
                    "name": name,
                    "phase": "coreml-skipped",
                    "label": "Core ML encoder unavailable — CPU fallback",
                    "progress": (progress_offset + progress_scale).clamp(0.0, 1.0),
                    "bytesDownloaded": 0u64,
                    "bytesTotal": 0u64,
                }),
            )
            .ok();
            false
        }
        Ok(()) => {
            // Unzip phase: notify the user so the UI doesn't freeze during extraction.
            app.emit(
                "model:download:progress",
                serde_json::json!({
                    "name": name,
                    "phase": "unzip",
                    "label": "Preparing Core ML encoder…",
                    "progress": unzip_progress,
                    "bytesDownloaded": 0u64,
                    "bytesTotal": 0u64,
                }),
            )
            .ok();

            match unzip_coreml_encoder(&zip_dest, models).await {
                Err(e) => {
                    log::warn!("Core ML encoder unzip failed: {e}");
                    let _ = fs::remove_file(&zip_dest).await;
                    false
                }
                Ok(()) => {
                    log::info!("Core ML encoder installed for {}", name.filename());
                    true
                }
            }
        }
    };

    ok
}

// ---------------------------------------------------------------------------
// transcribe  (public Tauri command)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: TranscribeOpts,
) -> Result<TranscribeResult, String> {
    let job = state
        .jobs
        .create(
            &app,
            JobKind::Transcribe,
            format!("Transcribing (whisper.cpp) — {}", &opts.model_name),
        )
        .await;
    job.mark_running().await;
    let job_for_progress = job.clone();
    let media_id_for_progress = opts.media_id.clone();

    let result =
        transcribe_inner(&app, &opts, &job_for_progress, &media_id_for_progress).await;
    match &result {
        Ok(_) => job.mark_completed().await,
        Err(e) => job.mark_failed(e.clone()).await,
    }
    result
}

async fn transcribe_inner(
    app: &AppHandle,
    opts: &TranscribeOpts,
    job: &crate::jobs::JobHandle,
    media_id: &str,
) -> Result<TranscribeResult, String> {
    app.emit(
        "transcribe:progress",
        TranscribeProgress {
            media_id: opts.media_id.clone(),
            progress: 0.01,
            current_time: 0.0,
        },
    )
    .ok();

    // 1) Extract audio to a temp wav (same for both engines)
    let wav = tempfile_with_ext("wav");
    let shell = app.shell();
    let ffmpeg = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not available: {e}"))?
        .args([
            "-y",
            "-i", &opts.media_path,
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            "-c:a", "pcm_s16le",
            wav.to_str().unwrap(),
        ]);
    let (mut rx, _child) = ffmpeg.spawn().map_err(|e| format!("spawn ffmpeg: {e}"))?;
    while let Some(ev) = rx.recv().await {
        if let CommandEvent::Terminated(t) = ev {
            if t.code != Some(0) {
                return Err("ffmpeg failed extracting audio".into());
            }
            break;
        }
    }

    // 2) Transcribe with whisper.cpp
    let words = transcribe_whisper_cpp(app, opts, job, &wav).await?;

    let _ = media_id;

    // 3) Emit final "done"
    let total_duration = opts.media_duration.max(1.0);
    app.emit(
        "transcribe:progress",
        TranscribeProgress {
            media_id: opts.media_id.clone(),
            progress: 1.0,
            current_time: total_duration,
        },
    )
    .ok();

    Ok(TranscribeResult {
        media_id: opts.media_id.clone(),
        words,
        engine: opts.engine,
    })
}

// ---------------------------------------------------------------------------
// whisper.cpp path
// ---------------------------------------------------------------------------

async fn transcribe_whisper_cpp(
    app: &AppHandle,
    opts: &TranscribeOpts,
    job: &crate::jobs::JobHandle,
    wav: &PathBuf,
) -> Result<Vec<Word>, String> {
    let models = models_dir(app)?;

    let model_enum: WhisperModel =
        serde_json::from_value(serde_json::Value::String(opts.model_name.clone()))
            .map_err(|_| format!("unknown whisper-cpp model: {}", opts.model_name))?;

    let model_path = models.join(model_enum.filename());
    if !model_path.exists() {
        return Err(format!(
            "model not installed: {}. Call download_model first.",
            model_enum.filename()
        ));
    }

    let use_coreml = ensure_coreml_encoder(app, &models, model_enum, 0.0, 1.0).await;
    if !use_coreml {
        log::warn!(
            "Core ML encoder unavailable for {} — falling back to CPU (--no-gpu)",
            model_enum.filename()
        );
    }

    let model_str = model_path.to_str().unwrap().to_string();
    let wav_str = wav.to_str().unwrap().to_string();
    let mut whisper_args: Vec<String> = vec![
        "-m".into(), model_str,
        "-f".into(), wav_str,
        "--output-json-full".into(),
        // ── Timestamp accuracy flags ─────────────────────────────────────
        // Split tokens at word boundaries so each Word gets its own tight
        // start/end offset rather than inheriting the whole segment range.
        "--split-on-word".into(),
        // Low probability threshold: keep all tokens, even uncertain ones.
        // The editor always shows every word; users decide what to delete.
        "--word-thold".into(), "0.01".into(),
        // Disable the maximum-segment-length cap. When max-len is set,
        // whisper can rush short segments to hit the token budget, which
        // compresses timestamps and causes video/text drift. Setting it to
        // 0 lets each segment run as long as needed for accurate timing.
        "--max-len".into(), "0".into(),
        // Use beam search with 5 candidates for better transcript quality.
        // This has no impact on timing but reduces hallucinations that can
        // also throw off the word index ↔ timestamp mapping.
        "--best-of".into(), "5".into(),
        "--beam-size".into(), "5".into(),
    ];

    // DTW-based word timestamp refinement (whisper.cpp ≥ 1.5).
    // Uses Dynamic Time Warping on the mel spectrogram to pin each word's
    // start/end to its actual audio onset — brings timing accuracy from
    // ~100 ms down to ~20 ms, similar to Descript-grade forced alignment.
    // Only available for the presets the bundled whisper-cli ships aheads for.
    if let Some(dtw) = dtw_preset_for_model(&opts.model_name) {
        whisper_args.push("--dtw".into());
        whisper_args.push(dtw.into());
    } else if opts.model_name == "large-v3" {
        log::info!(
            "Skipping DTW for large-v3 because bundled whisper-cli does not support that preset"
        );
    }

    if !use_coreml {
        whisper_args.push("--no-gpu".into());
    }
    // Language / translation flags
    let effective_language = opts.language.as_deref().filter(|l| !l.is_empty() && *l != "auto");
    if let Some(lang) = effective_language {
        whisper_args.push("--language".into());
        whisper_args.push(lang.to_string());
    }
    if opts.translate {
        whisper_args.push("--translate".into());
    }
    // Speaker diarisation
    if opts.diarize {
        whisper_args.push("--diarize".into());
    }

    let shell = app.shell();
    let whisper = shell
        .sidecar("whisper-cli")
        .map_err(|e| format!("whisper-cli sidecar not available: {e}"))?
        .args(whisper_args);

    let (mut rx, _child) = whisper.spawn().map_err(|e| format!("spawn whisper-cli: {e}"))?;
    let mut stderr = String::new();
    let total_duration = opts.media_duration.max(1.0);

    // Progress is driven by two sources, reconciled so it only ever moves
    // forward (`last_progress` is monotonic):
    //   1. Real progress parsed from whisper-cli stderr timestamp lines.
    //   2. A 1-second synthetic heartbeat, used whenever real progress lags or
    //      never arrives (some whisper-cli builds buffer those lines until the
    //      very end, which previously froze the overlay at 1%).
    let started_at = std::time::Instant::now();
    let mut last_progress: f64 = 0.01;
    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
    // Drop the immediate first tick so the heartbeat starts ~1 s in.
    ticker.tick().await;

    let exit_ok = loop {
        tokio::select! {
            maybe_ev = rx.recv() => {
                match maybe_ev {
                    Some(CommandEvent::Stderr(line)) => {
                        let line = String::from_utf8_lossy(&line).to_string();
                        stderr.push_str(&line);
                        stderr.push('\n');
                        if let Some(current_time) = parse_progress_line(&line) {
                            let real = (current_time / total_duration).clamp(0.02, 0.99);
                            // Never move backwards: only adopt real progress if it
                            // exceeds whatever synthetic progress already reported.
                            if real > last_progress {
                                last_progress = real;
                                app.emit(
                                    "transcribe:progress",
                                    TranscribeProgress {
                                        media_id: opts.media_id.clone(),
                                        progress: last_progress,
                                        current_time,
                                    },
                                )
                                .ok();
                                let eta = ((total_duration - current_time).max(0.0)) as i64;
                                job.set_progress(last_progress, Some(eta)).await;
                            }
                        }
                    }
                    Some(CommandEvent::Terminated(t)) => {
                        break t.code == Some(0);
                    }
                    Some(_) => {}
                    // Channel closed without an explicit Terminated event —
                    // treat as a clean finish and let JSON parsing be the judge.
                    None => break true,
                }
            }
            _ = ticker.tick() => {
                // Heartbeat: advance synthetic progress while Whisper is busy so
                // the overlay never looks frozen. Capped at 95% by the helper.
                let elapsed = started_at.elapsed().as_secs_f64();
                let synthetic = synthetic_transcribe_progress(elapsed, total_duration);
                if synthetic > last_progress {
                    last_progress = synthetic;
                    let current_time = (last_progress * total_duration).min(total_duration);
                    app.emit(
                        "transcribe:progress",
                        TranscribeProgress {
                            media_id: opts.media_id.clone(),
                            progress: last_progress,
                            current_time,
                        },
                    )
                    .ok();
                    job.set_progress(last_progress, None).await;
                }
            }
        }
    };

    if !exit_ok {
        return Err(format!("whisper-cli failed: {}", stderr.trim()));
    }

    let json_path = wav.with_extension("wav.json");
    let json = fs::read_to_string(&json_path)
        .await
        .map_err(|e| format!("reading whisper json {}: {}", json_path.display(), e))?;
    let words = parse_whisper_json(&json).map_err(|e| e.to_string())?;

    let _ = fs::remove_file(wav).await;
    let _ = fs::remove_file(&json_path).await;

    Ok(words)
}

// ---------------------------------------------------------------------------
// Progress line parsers
// ---------------------------------------------------------------------------

/// Synthetic transcription progress as a function of elapsed wall-clock time.
///
/// Used as a heartbeat when whisper-cli does not emit (or buffers) its stderr
/// timestamp lines, so the UI never appears frozen. The curve is monotonic,
/// starts at ~1 %, and is hard-capped at 95 % — real parsed progress (or the
/// final 100 % on completion) always takes over when available.
///
/// `media_duration` lightly scales the ramp so short clips reach high progress
/// sooner, but the knees are clamped to sane wall-clock bounds either way.
fn synthetic_transcribe_progress(elapsed_sec: f64, media_duration: f64) -> f64 {
    // Time to reach ~50 % and ~85 % respectively, bounded so neither tiny nor
    // huge media produces a degenerate curve.
    let knee1 = (media_duration * 0.5).clamp(20.0, 60.0);
    let knee2 = (media_duration * 1.5).clamp(knee1 + 30.0, 180.0);

    let p = if elapsed_sec <= knee1 {
        0.01 + (elapsed_sec / knee1) * (0.50 - 0.01)
    } else if elapsed_sec <= knee2 {
        0.50 + ((elapsed_sec - knee1) / (knee2 - knee1)) * (0.85 - 0.50)
    } else {
        // Approach 0.95 slowly over the following ~10 minutes.
        let extra = elapsed_sec - knee2;
        0.85 + (extra / 600.0) * (0.95 - 0.85)
    };
    p.clamp(0.01, 0.95)
}

/// Parse a whisper.cpp stderr progress line:
///   `[00:00:30.000 --> 00:00:32.500]` → 32.5 seconds
fn parse_progress_line(line: &str) -> Option<f64> {
    let line = line.trim();
    if !line.starts_with('[') {
        return None;
    }
    let arrow = line.find("--> ")?;
    let end = line[arrow + 4..].find(']')?;
    let ts = &line[arrow + 4..arrow + 4 + end];
    parse_timestamp(ts)
}

fn parse_timestamp(s: &str) -> Option<f64> {
    let mut parts = s.split(':');
    let h: u64 = parts.next()?.parse().ok()?;
    let m: u64 = parts.next()?.parse().ok()?;
    let s = parts.next()?;
    let secs: f64 = s.parse().ok()?;
    Some((h * 3600 + m * 60) as f64 + secs)
}

fn tempfile_with_ext(ext: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("yusafcut-{}.{}", uuid::Uuid::new_v4(), ext));
    p
}

/// Map a model slug to the `--dtw` preset the bundled `whisper-cli` accepts.
///
/// DTW (Dynamic Time Warping) refines word timestamps, but the bundled
/// whisper-cli only ships the alignment heads for a subset of presets. Passing
/// an unknown preset makes whisper-cli abort with
/// `error: unknown DTW preset '<name>'` before producing any JSON.
///
/// `large-v3` and `large-v3-turbo` are intentionally excluded: the current
/// binary rejects `--dtw large-v3`, and the turbo/distilled variants are not in
/// its DTW model list. Both still transcribe fine without DTW.
fn dtw_preset_for_model(model_name: &str) -> Option<&'static str> {
    match model_name {
        "tiny" => Some("tiny"),
        "base" => Some("base"),
        "small" => Some("small"),
        "medium" => Some("medium"),
        "large-v1" => Some("large-v1"),
        "large-v2" => Some("large-v2"),
        // Bundled whisper-cli rejects `--dtw large-v3`; skip rather than fail.
        "large-v3" => None,
        "large-v3-turbo" => None,
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whisper_cpp_progress_line() {
        let line = "[00:00:30.500 --> 00:00:32.500]  hello world";
        assert_eq!(parse_progress_line(line), Some(32.5));
    }

    #[test]
    fn rejects_non_progress_lines() {
        assert_eq!(parse_progress_line("loading model"), None);
        assert_eq!(parse_progress_line("[foo]"), None);
    }

    #[test]
    fn coreml_encoder_names() {
        assert_eq!(
            WhisperModel::Tiny.coreml_encoder_dir(),
            "ggml-tiny-encoder.mlmodelc"
        );
        assert_eq!(
            WhisperModel::LargeV3Turbo.coreml_encoder_dir(),
            "ggml-large-v3-turbo-encoder.mlmodelc"
        );
        assert_eq!(
            WhisperModel::Tiny.coreml_encoder_zip(),
            "ggml-tiny-encoder.mlmodelc.zip"
        );
    }

    #[test]
    fn synthetic_progress_starts_low_and_is_capped() {
        // Starts at ~1 % and never exceeds the 95 % cap, even far out.
        assert!((synthetic_transcribe_progress(0.0, 120.0) - 0.01).abs() < 1e-6);
        assert!(synthetic_transcribe_progress(0.0, 120.0) >= 0.01);
        assert!(synthetic_transcribe_progress(100_000.0, 120.0) <= 0.95);
        assert!(synthetic_transcribe_progress(100_000.0, 5.0) <= 0.95);
    }

    #[test]
    fn synthetic_progress_is_monotonic() {
        // Across a wide range of elapsed times the curve must never decrease.
        let mut prev = 0.0;
        for sec in 0..2000 {
            let p = synthetic_transcribe_progress(sec as f64, 120.0);
            assert!(p >= prev - 1e-9, "regressed at {sec}s: {p} < {prev}");
            assert!(p <= 0.95 + 1e-9);
            prev = p;
        }
    }

    #[test]
    fn dtw_preset_supported_models() {
        assert_eq!(dtw_preset_for_model("tiny"), Some("tiny"));
        assert_eq!(dtw_preset_for_model("base"), Some("base"));
        assert_eq!(dtw_preset_for_model("small"), Some("small"));
        assert_eq!(dtw_preset_for_model("medium"), Some("medium"));
        assert_eq!(dtw_preset_for_model("large-v1"), Some("large-v1"));
        assert_eq!(dtw_preset_for_model("large-v2"), Some("large-v2"));
    }

    #[test]
    fn dtw_preset_unsupported_models_return_none() {
        // The bundled whisper-cli rejects `--dtw large-v3`, and turbo/distilled
        // variants are not in its DTW model list — both must skip DTW.
        assert_eq!(dtw_preset_for_model("large-v3"), None);
        assert_eq!(dtw_preset_for_model("large-v3-turbo"), None);
        assert_eq!(dtw_preset_for_model("unknown-model"), None);
    }

    #[test]
    fn transcription_engine_default_is_whisper_cpp() {
        let engine = TranscriptionEngine::default();
        assert_eq!(engine, TranscriptionEngine::WhisperCpp);
    }

    #[test]
    fn transcription_engine_deserialises_from_json() {
        let e: TranscriptionEngine =
            serde_json::from_str("\"whisper-cpp\"").unwrap();
        assert_eq!(e, TranscriptionEngine::WhisperCpp);
    }
}
