# Phase A: DTW Word-Timestamp Sync Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Word timestamps accurate enough that click-to-seek, playback highlight, and export cuts all feel exact, with no drift over long videos (spec section A of `docs/superpowers/specs/2026-07-06-editing-accuracy-and-left-sidebar-design.md`).

**Architecture:** Enable whisper.cpp DTW timestamp refinement for `large-v3` / `large-v3-turbo` (requires an upgraded `whisper-cli` sidecar), parse the DTW-refined `t_dtw` token timestamps with fallback to standard offsets, retry without `--dtw` when the binary rejects it, and snap word boundaries to ffmpeg-detected silences in a new pure TypeScript module.

**Tech Stack:** Rust (serde, existing sidecar plumbing), TypeScript (pure lib module + Vitest), whisper.cpp ≥ 1.7.x sidecar build.

## Global Constraints

- Branch: create `feature/dtw-word-sync` **from `feature/right-sidebar-ui`** (NOT main — main is still at 4.3.0 and lacks the v4.4.0 layout this stacks on).
- Never mention Claude, AI, or AI assistance in commits, code comments, or docs. No Co-Authored-By tags.
- Version bump to **4.5.0** in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (Task 6).
- Docs updated in the same commit as the code they describe (repo CLAUDE.md rule).
- Prettier: double quotes, semicolons, trailing commas, 100-char width, 2-space indent.
- Commit and push only — never create a PR or merge.
- EDL invariants unchanged: `Word.start`/`Word.end` remain immutable source timecodes (they just become accurate).

---

### Task 0: Branch setup

- [ ] **Step 1: Create the branch**

```bash
cd /Users/mohr/code/projects/yusaf-cut
git checkout feature/right-sidebar-ui && git pull origin feature/right-sidebar-ui
git checkout -b feature/dtw-word-sync
```

---

### Task 1: DTW presets for large-v3 and large-v3-turbo

**Files:**
- Modify: `src-tauri/src/commands/transcribe.rs` (`dtw_preset_for_model` at ~line 857, its call site at ~line 664, and the two `dtw_preset_*` tests at ~line 930)

**Interfaces:**
- Produces: `dtw_preset_for_model(model_name: &str) -> Option<&'static str>` now returns `Some("large.v3")` / `Some("large.v3.turbo")` for the large-v3 family. Modern whisper.cpp uses dot-separated preset names for large models (`large.v1`, `large.v2`, `large.v3`, `large.v3.turbo`).

- [ ] **Step 1: Rewrite the two DTW preset tests to expect the new mapping**

Replace the existing `dtw_preset_supported_models` and `dtw_preset_unsupported_models_return_none` tests in the `tests` module of `src-tauri/src/commands/transcribe.rs` with:

```rust
    #[test]
    fn dtw_preset_supported_models() {
        assert_eq!(dtw_preset_for_model("tiny"), Some("tiny"));
        assert_eq!(dtw_preset_for_model("base"), Some("base"));
        assert_eq!(dtw_preset_for_model("small"), Some("small"));
        assert_eq!(dtw_preset_for_model("medium"), Some("medium"));
        // Modern whisper.cpp names large-model presets with dots.
        assert_eq!(dtw_preset_for_model("large-v1"), Some("large.v1"));
        assert_eq!(dtw_preset_for_model("large-v2"), Some("large.v2"));
        assert_eq!(dtw_preset_for_model("large-v3"), Some("large.v3"));
        assert_eq!(dtw_preset_for_model("large-v3-turbo"), Some("large.v3.turbo"));
    }

    #[test]
    fn dtw_preset_unknown_model_returns_none() {
        assert_eq!(dtw_preset_for_model("unknown-model"), None);
        assert_eq!(dtw_preset_for_model(""), None);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test dtw_preset`
Expected: FAIL — `large-v1` maps to `"large-v1"` (old hyphen form) and `large-v3`/`large-v3-turbo` map to `None`.

- [ ] **Step 3: Update `dtw_preset_for_model` and its doc comment**

Replace the whole function (including its doc comment) with:

```rust
/// Map a model slug to the `--dtw` preset the bundled `whisper-cli` accepts.
///
/// DTW (Dynamic Time Warping) refines word timestamps using cross-attention
/// alignment, bringing per-word accuracy from ~100 ms down to ~20 ms. Modern
/// whisper.cpp (≥ 1.7.x) ships alignment heads for every preset below,
/// including `large.v3` and `large.v3.turbo` (dot-separated names).
///
/// If the bundled binary is older and rejects the preset, the caller retries
/// once without `--dtw` — see `stderr_mentions_dtw_failure`.
fn dtw_preset_for_model(model_name: &str) -> Option<&'static str> {
    match model_name {
        "tiny" => Some("tiny"),
        "base" => Some("base"),
        "small" => Some("small"),
        "medium" => Some("medium"),
        "large-v1" => Some("large.v1"),
        "large-v2" => Some("large.v2"),
        "large-v3" => Some("large.v3"),
        "large-v3-turbo" => Some("large.v3.turbo"),
        _ => None,
    }
}
```

Also delete the now-dead `else if opts.model_name == "large-v3"` log branch at the call site (~line 667-671) — every known model now gets a preset:

```rust
    if let Some(dtw) = dtw_preset_for_model(&opts.model_name) {
        whisper_args.push("--dtw".into());
        whisper_args.push(dtw.into());
    }
```

(Note: `stderr_mentions_dtw_failure` referenced in the doc comment is added in Task 3. The doc comment forward-references it; that is fine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test dtw_preset`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/transcribe.rs
git commit -m "feat: enable DTW timestamp presets for large-v3 and large-v3-turbo"
```

---

### Task 2: Parse DTW-refined `t_dtw` token timestamps

**Files:**
- Modify: `src-tauri/src/transcribe.rs` (parser + tests)

**Interfaces:**
- Consumes: whisper.cpp `--output-json-full` token objects, which with `--dtw` gain a `"t_dtw"` field: an integer in **centiseconds** (10 ms units), `-1` when DTW was not computed.
- Produces: `parse_whisper_json(json: &str) -> Result<Vec<Word>>` (unchanged signature) now prefers DTW timestamps when present.

**Semantics:** `t_dtw` marks the boundary where a token's audio **ends** (the moment the model "heard" the token). A word therefore spans from the previous token's boundary to its own. The previous boundary is tracked across ALL tokens, including skipped punctuation tokens, so the next word starts where the last acoustic token actually ended. Fallback: any token with `t_dtw < 0` (or absent) uses the existing `offsets`-based path.

> ⚠️ Empirical check in Task 6: if real-world words appear shifted late by one token, the interpretation is inverted (t_dtw = onset) — then swap to (own t_dtw → next token's t_dtw). The unit tests below pin the *mechanics*, the manual test pins the *interpretation*.

- [ ] **Step 1: Write the failing tests**

Append to the `tests` module in `src-tauri/src/transcribe.rs`:

```rust
    #[test]
    fn prefers_dtw_timestamps_when_present() {
        // t_dtw is in centiseconds and marks the END of each token.
        // Word 1: start = offsets fallback (no previous boundary), end = 0.5 s.
        // Word 2: start = word 1's boundary (0.5 s), end = 1.1 s.
        let json = r#"{
            "transcription": [
              {
                "text": " hello world",
                "offsets": {"from": 0, "to": 1500},
                "tokens": [
                  {"text": " hello", "offsets": {"from": 0, "to": 400}, "p": 0.99, "t_dtw": 50},
                  {"text": " world", "offsets": {"from": 600, "to": 1100}, "p": 0.95, "t_dtw": 110}
                ]
              }
            ]
        }"#;
        let words = parse_whisper_json(json).unwrap();
        assert_eq!(words.len(), 2);
        assert!((words[0].start - 0.0).abs() < 1e-9);
        assert!((words[0].end - 0.5).abs() < 1e-9);
        assert!((words[1].start - 0.5).abs() < 1e-9);
        assert!((words[1].end - 1.1).abs() < 1e-9);
    }

    #[test]
    fn falls_back_to_offsets_when_t_dtw_negative_or_absent() {
        let json = r#"{
            "transcription": [
              {
                "text": " hello world",
                "offsets": {"from": 0, "to": 1500},
                "tokens": [
                  {"text": " hello", "offsets": {"from": 0, "to": 500}, "p": 0.99, "t_dtw": -1},
                  {"text": " world", "offsets": {"from": 600, "to": 1100}, "p": 0.95}
                ]
              }
            ]
        }"#;
        let words = parse_whisper_json(json).unwrap();
        assert_eq!(words.len(), 2);
        assert!((words[0].start - 0.0).abs() < 1e-9);
        assert!((words[0].end - 0.5).abs() < 1e-9);
        assert!((words[1].start - 0.6).abs() < 1e-9);
        assert!((words[1].end - 1.1).abs() < 1e-9);
    }

    #[test]
    fn skipped_punctuation_tokens_still_advance_the_dtw_boundary() {
        // The "," token is dropped from output but its t_dtw (0.7 s) becomes
        // the start boundary of the following word.
        let json = r#"{
            "transcription": [
              {
                "text": " hi, there",
                "offsets": {"from": 0, "to": 2000},
                "tokens": [
                  {"text": " hi", "offsets": {"from": 0, "to": 300}, "p": 0.99, "t_dtw": 40},
                  {"text": ",", "offsets": {"from": 300, "to": 400}, "p": 0.99, "t_dtw": 70},
                  {"text": " there", "offsets": {"from": 400, "to": 900}, "p": 0.95, "t_dtw": 120}
                ]
              }
            ]
        }"#;
        let words = parse_whisper_json(json).unwrap();
        assert_eq!(words.len(), 2);
        assert!((words[1].start - 0.7).abs() < 1e-9);
        assert!((words[1].end - 1.2).abs() < 1e-9);
    }

    #[test]
    fn non_monotonic_dtw_is_clamped_to_a_positive_duration() {
        // Second token's t_dtw (0.4 s) is BEFORE the previous boundary (0.5 s):
        // start is clamped down to the token's own end, then end = start + 1 ms.
        let json = r#"{
            "transcription": [
              {
                "text": " a b",
                "offsets": {"from": 0, "to": 1000},
                "tokens": [
                  {"text": " aa", "offsets": {"from": 0, "to": 300}, "p": 0.99, "t_dtw": 50},
                  {"text": " bb", "offsets": {"from": 300, "to": 600}, "p": 0.95, "t_dtw": 40}
                ]
              }
            ]
        }"#;
        let words = parse_whisper_json(json).unwrap();
        assert_eq!(words.len(), 2);
        assert!(words[1].end > words[1].start);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib transcribe`
Expected: the four new tests FAIL (serde ignores the unknown `t_dtw` field today, so DTW values are never used); the three existing tests still PASS.

- [ ] **Step 3: Implement `t_dtw` parsing**

In `src-tauri/src/transcribe.rs`, change `WhisperToken` to:

```rust
#[derive(Debug, Deserialize)]
struct WhisperToken {
    text: String,
    offsets: WhisperOffsets,
    p: f64, // probability
    /// DTW-refined timestamp in centiseconds (10 ms units). Emitted by
    /// whisper-cli when run with `--dtw`; -1 (or absent) means unavailable.
    /// Marks the END boundary of the token's audio.
    #[serde(default = "default_t_dtw")]
    t_dtw: i64,
}

fn default_t_dtw() -> i64 {
    -1
}
```

Replace the body of `parse_whisper_json` with:

```rust
pub fn parse_whisper_json(json: &str) -> Result<Vec<Word>> {
    let parsed: WhisperJson = serde_json::from_str(json).context("invalid whisper JSON")?;
    let mut words = Vec::new();
    // t_dtw marks where each token's audio ENDS, so a word spans from the
    // previous token's boundary to its own. Track the boundary across all
    // tokens — including skipped punctuation — so the next word starts where
    // the last acoustic token actually ended.
    let mut prev_dtw_ms: Option<u64> = None;
    for seg in parsed.transcription {
        for tok in seg.tokens {
            let dtw_ms = if tok.t_dtw >= 0 {
                Some(tok.t_dtw as u64 * 10)
            } else {
                None
            };
            let text = tok.text.trim().to_string();
            // Skip Whisper special tokens like <|startoftranscript|>, [BLANK_AUDIO], etc.
            let skip = text.is_empty()
                || text.starts_with("<|")
                || text.starts_with('[')
                || text.chars().all(|c| !c.is_alphanumeric());
            if skip {
                if let Some(d) = dtw_ms {
                    prev_dtw_ms = Some(d);
                }
                continue;
            }
            let (fb_start, fb_end) = token_offsets_ms(&seg.offsets, &tok.offsets);
            let (start_ms, end_ms) = match dtw_ms {
                Some(dtw_end) => {
                    let start = prev_dtw_ms.unwrap_or(fb_start).min(dtw_end);
                    (start, dtw_end.max(start + 1))
                }
                None => (fb_start, fb_end),
            };
            if let Some(d) = dtw_ms {
                prev_dtw_ms = Some(d);
            }
            words.push(Word {
                id: Uuid::new_v4().to_string(),
                text,
                start: ms_to_sec(start_ms),
                end: ms_to_sec(end_ms),
                confidence: tok.p.clamp(0.0, 1.0),
                speaker: None,
            });
        }
    }
    Ok(words)
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd src-tauri && cargo test --lib transcribe`
Expected: PASS — all 7 parser tests (3 pre-existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/transcribe.rs
git commit -m "feat: use DTW-refined token timestamps when whisper emits them"
```

---

### Task 3: Graceful retry when whisper-cli rejects `--dtw`

**Files:**
- Modify: `src-tauri/src/commands/transcribe.rs` (`transcribe_whisper_cpp`, ~lines 690-786, plus tests module)

**Interfaces:**
- Produces:
  - `async fn run_whisper_cli(app: &AppHandle, opts: &TranscribeOpts, job: &crate::jobs::JobHandle, args: Vec<String>) -> Result<(bool, String), String>` — spawns whisper-cli, streams progress (existing loop, moved verbatim), returns `(exit_ok, stderr)`.
  - `fn stderr_mentions_dtw_failure(stderr: &str) -> bool` — pure predicate.
  - `fn strip_dtw_args(args: Vec<String>) -> Vec<String>` — pure, removes `--dtw <preset>`.

- [ ] **Step 1: Write failing tests for the two pure helpers**

Append to the `tests` module in `src-tauri/src/commands/transcribe.rs`:

```rust
    #[test]
    fn detects_dtw_rejection_in_stderr() {
        // New binary, bad preset name:
        assert!(stderr_mentions_dtw_failure(
            "error: unknown DTW preset 'large.v3.turbo'"
        ));
        // Old binary that has no --dtw flag at all:
        assert!(stderr_mentions_dtw_failure("error: unknown argument: --dtw"));
        // Unrelated failures must NOT trigger the retry:
        assert!(!stderr_mentions_dtw_failure("ggml_metal_init: failed"));
        assert!(!stderr_mentions_dtw_failure(""));
    }

    #[test]
    fn strip_dtw_args_removes_flag_and_value() {
        let args: Vec<String> = vec!["-m", "model.bin", "--dtw", "large.v3", "-f", "audio.wav"]
            .into_iter()
            .map(String::from)
            .collect();
        let stripped = strip_dtw_args(args);
        assert_eq!(stripped, vec!["-m", "model.bin", "-f", "audio.wav"]);
    }

    #[test]
    fn strip_dtw_args_is_noop_without_flag() {
        let args: Vec<String> = vec!["-m", "model.bin"].into_iter().map(String::from).collect();
        assert_eq!(strip_dtw_args(args.clone()), args);
    }
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run: `cd src-tauri && cargo test strip_dtw`
Expected: COMPILE ERROR — `stderr_mentions_dtw_failure` / `strip_dtw_args` not found.

- [ ] **Step 3: Implement helpers and the retry**

Add near `dtw_preset_for_model`:

```rust
/// True when a failed whisper-cli run looks like a DTW-preset rejection
/// (stale bundled binary) rather than a genuine transcription failure.
fn stderr_mentions_dtw_failure(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    s.contains("dtw") && (s.contains("unknown") || s.contains("invalid"))
}

/// Remove `--dtw <preset>` from an argument list.
fn strip_dtw_args(args: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut skip_next = false;
    for a in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if a == "--dtw" {
            skip_next = true;
            continue;
        }
        out.push(a);
    }
    out
}
```

Then refactor `transcribe_whisper_cpp`: extract everything from `let shell = app.shell();` (line ~690) through the `let exit_ok = loop { ... };` block (line ~770) into:

```rust
/// Spawn whisper-cli with `args`, stream progress to the UI, and return
/// `(exit_ok, captured_stderr)`. The progress loop is unchanged from the
/// original inline version: real stderr timestamps reconciled with a 1 s
/// synthetic heartbeat, monotonic, capped at 95 %.
async fn run_whisper_cli(
    app: &AppHandle,
    opts: &TranscribeOpts,
    job: &crate::jobs::JobHandle,
    args: Vec<String>,
) -> Result<(bool, String), String> {
    let shell = app.shell();
    let whisper = shell
        .sidecar("whisper-cli")
        .map_err(|e| format!("whisper-cli sidecar not available: {e}"))?
        .args(args);

    let (mut rx, _child) = whisper.spawn().map_err(|e| format!("spawn whisper-cli: {e}"))?;
    let mut stderr = String::new();
    // … move the ENTIRE existing progress/select loop here verbatim,
    //   including `total_duration`, `started_at`, `last_progress`, `ticker` …
    Ok((exit_ok, stderr))
}
```

(The loop body is moved without modification — `opts`, `job`, and `app` are already parameters. `total_duration` is computed inside from `opts.media_duration.max(1.0)`.)

In `transcribe_whisper_cpp`, replace the removed block with:

```rust
    let (mut exit_ok, mut stderr) =
        run_whisper_cli(app, opts, job, whisper_args.clone()).await?;

    // A stale bundled binary rejects the --dtw preset before transcribing.
    // Retry once without DTW rather than failing the whole transcription.
    if !exit_ok && stderr_mentions_dtw_failure(&stderr) {
        log::warn!("whisper-cli rejected --dtw — retrying without DTW refinement");
        let (retry_ok, retry_stderr) =
            run_whisper_cli(app, opts, job, strip_dtw_args(whisper_args)).await?;
        exit_ok = retry_ok;
        stderr = retry_stderr;
    }

    if !exit_ok {
        return Err(format!("whisper-cli failed: {}", stderr.trim()));
    }
```

(`whisper_args` now needs to be built before the first call and passed by clone — it already is a `Vec<String>` local.)

- [ ] **Step 4: Run all Rust tests**

Run: `cd src-tauri && cargo test`
Expected: PASS — including the 3 new helper tests; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/transcribe.rs
git commit -m "feat: retry transcription without --dtw when whisper-cli rejects the preset"
```

---

### Task 4: Silence-boundary snapping module

**Files:**
- Create: `src/lib/timestampSnap.ts`
- Test: `tests/timestampSnap.test.ts`

**Interfaces:**
- Consumes: `Word` from `@/lib/edl`, `PauseSegment` from `@/lib/ipc`.
- Produces:
  - `snapWordsToSilences(words: Word[], silences: PauseSegment[]): Word[]` — pure; returns the same array reference when nothing changes.
  - `MAX_SNAP_ADJUSTMENT = 0.12` (seconds, exported const).

- [ ] **Step 1: Write the failing tests**

Create `tests/timestampSnap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Word } from "@/lib/edl";
import type { PauseSegment } from "@/lib/ipc";
import { snapWordsToSilences } from "@/lib/timestampSnap";

function word(id: string, start: number, end: number): Word {
  return { id, text: id, start, end, confidence: 1 };
}

function silence(start: number, end: number): PauseSegment {
  return { id: `${start}-${end}`, start, end, duration: end - start };
}

describe("snapWordsToSilences", () => {
  it("snaps a word start that falls inside a silence forward to the silence end", () => {
    const out = snapWordsToSilences([word("w", 1.45, 2.0)], [silence(0.9, 1.5)]);
    expect(out[0].start).toBeCloseTo(1.5, 9);
    expect(out[0].end).toBeCloseTo(2.0, 9);
  });

  it("snaps a word end that falls inside a silence back to the silence start", () => {
    const out = snapWordsToSilences([word("w", 1.0, 1.58)], [silence(1.5, 2.2)]);
    expect(out[0].start).toBeCloseTo(1.0, 9);
    expect(out[0].end).toBeCloseTo(1.5, 9);
  });

  it("leaves boundaries alone when the adjustment exceeds the 120 ms tolerance", () => {
    // end is 0.5 s past the silence start — too far to be a boundary error.
    const out = snapWordsToSilences([word("w", 0.5, 2.0)], [silence(1.5, 2.5)]);
    expect(out[0].start).toBeCloseTo(0.5, 9);
    expect(out[0].end).toBeCloseTo(2.0, 9);
  });

  it("never produces a degenerate (near-zero-duration) word", () => {
    // Snapping start to 1.5 would leave only 20 ms of word — skip it.
    const out = snapWordsToSilences([word("w", 1.45, 1.52)], [silence(0.9, 1.5)]);
    expect(out[0].start).toBeCloseTo(1.45, 9);
    expect(out[0].end).toBeCloseTo(1.52, 9);
  });

  it("leaves words untouched when they overlap no silence", () => {
    const words = [word("a", 0.0, 0.4), word("b", 0.5, 0.9)];
    const out = snapWordsToSilences(words, [silence(2.0, 3.0)]);
    expect(out[0]).toEqual(words[0]);
    expect(out[1]).toEqual(words[1]);
  });

  it("returns the input array unchanged when there are no silences", () => {
    const words = [word("a", 0.0, 0.4)];
    expect(snapWordsToSilences(words, [])).toBe(words);
  });

  it("handles unsorted silence input", () => {
    const out = snapWordsToSilences(
      [word("w", 3.05, 4.0)],
      [silence(5.0, 6.0), silence(2.5, 3.1)],
    );
    expect(out[0].start).toBeCloseTo(3.1, 9);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/timestampSnap.test.ts`
Expected: FAIL — module `@/lib/timestampSnap` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/lib/timestampSnap.ts`:

```ts
/**
 * Silence-boundary snapping for word timestamps.
 *
 * Whisper word boundaries are approximate; ffmpeg silencedetect boundaries are
 * signal-derived and exact. A word cannot start or end *inside* a silence —
 * so when a whisper boundary lands inside a detected silence, we pull it to
 * the silence edge. This guarantees cuts land in silence, never mid-word.
 *
 * Pure module: no React, no Tauri, no store imports (same rule as lib/edl.ts).
 */

import type { Word } from "./edl";
import type { PauseSegment } from "./ipc";

/**
 * Maximum boundary adjustment, in seconds. A discrepancy larger than this
 * means the timestamp is genuinely elsewhere — moving it would hurt, not help.
 */
export const MAX_SNAP_ADJUSTMENT = 0.12;

/** Minimum surviving word duration after snapping, in seconds. */
const MIN_WORD_DURATION = 0.02;

/** Binary search for the silence containing time `t` (sorted input). */
function silenceAt(silences: PauseSegment[], t: number): PauseSegment | null {
  let lo = 0;
  let hi = silences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = silences[mid];
    if (t < s.start) hi = mid - 1;
    else if (t > s.end) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Snap word boundaries that fall inside detected silences to the silence edge.
 * Words are never moved across their own other boundary, and adjustments are
 * capped at MAX_SNAP_ADJUSTMENT. Returns the input array when nothing changed.
 */
export function snapWordsToSilences(words: Word[], silences: PauseSegment[]): Word[] {
  if (silences.length === 0 || words.length === 0) return words;
  const sorted = [...silences].sort((a, b) => a.start - b.start);
  let changed = false;
  const out = words.map((w) => {
    let start = w.start;
    let end = w.end;

    // A word cannot begin inside a silence — speech starts when silence ends.
    const sStart = silenceAt(sorted, start);
    if (
      sStart &&
      sStart.end - start <= MAX_SNAP_ADJUSTMENT &&
      sStart.end < end - MIN_WORD_DURATION
    ) {
      start = sStart.end;
    }

    // A word cannot end inside a silence — speech stopped when silence began.
    const sEnd = silenceAt(sorted, end);
    if (
      sEnd &&
      end - sEnd.start <= MAX_SNAP_ADJUSTMENT &&
      sEnd.start > start + MIN_WORD_DURATION
    ) {
      end = sEnd.start;
    }

    if (start === w.start && end === w.end) return w;
    changed = true;
    return { ...w, start, end };
  });
  return changed ? out : words;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/timestampSnap.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/timestampSnap.ts tests/timestampSnap.test.ts
git commit -m "feat: snap word boundaries to detected silence edges"
```

---

### Task 5: Wire snapping into the transcription flows

**Files:**
- Modify: `src/components/Toolbar/Toolbar.tsx` (two spots: `startTranscribe` ~line 597-611, `importAndTranscribeRecording` ~line 320-330)

**Interfaces:**
- Consumes: `snapWordsToSilences` (Task 4), existing `detectPauses` from `@/lib/ipc`.
- Behavior: snapping runs only on **freshly transcribed** words (before they are cached, so the cache stores snapped words and cached reloads need no re-snap). Pause detection failure never fails transcription. The existing `autoDetectPauses` post-step (badges) is unchanged.

- [ ] **Step 1: Add the import**

In `src/components/Toolbar/Toolbar.tsx`, add to the imports:

```ts
import { snapWordsToSilences } from "@/lib/timestampSnap";
```

- [ ] **Step 2: Snap in `startTranscribe`**

Replace the words-acquisition expression inside the media loop (currently `const words = cached ?? (await transcribe({ … })).words;`) with:

```ts
        let words: Word[];
        if (cached) {
          words = cached; // cache already contains snapped timestamps
        } else {
          words = (
            await transcribe({
              mediaId,
              mediaPath: media.path,
              engine: "whisper-cpp",
              modelName: selectedModel,
              mediaDuration: media.duration,
              language: transcribeLanguage === "auto" ? undefined : transcribeLanguage,
              translate: transcribeTranslate,
              diarize: transcribeDiarize,
            })
          ).words;
          // Snap word boundaries to signal-level silence edges (best-effort —
          // a silencedetect failure must never fail the transcription).
          try {
            const silences = await detectPauses({
              mediaPath: media.path,
              noiseThreshold: -35,
              minDuration: 0.5,
            });
            words = snapWordsToSilences(words, silences);
          } catch {
            /* non-fatal */
          }
        }
```

(`Word` is already imported in Toolbar.tsx via `@/lib/edl` types — if not, add `import type { Word } from "@/lib/edl";`.)

- [ ] **Step 3: Snap in `importAndTranscribeRecording`**

After `const result = await transcribe({ … });` (~line 320) and before `writeTranscriptCache(media, result.words);`, insert the same best-effort snap and use the snapped list everywhere below:

```ts
      let recordedWords = result.words;
      try {
        const silences = await detectPauses({
          mediaPath: media.path,
          noiseThreshold: -35,
          minDuration: 0.5,
        });
        recordedWords = snapWordsToSilences(recordedWords, silences);
      } catch {
        /* non-fatal */
      }
      writeTranscriptCache(media, recordedWords);
```

…and in the `replaceProjectBaseline` segment construction below, change `words: result.words` → `words: recordedWords`, and the toast `${result.words.length} words` → `${recordedWords.length} words`.

- [ ] **Step 4: Verify with typecheck + lint + full JS tests**

Run: `npm run check && npm test`
Expected: PASS, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/Toolbar/Toolbar.tsx
git commit -m "feat: apply silence snapping to freshly transcribed words"
```

---

### Task 6: Upgrade the bundled whisper-cli and verify end-to-end

> **Environment note:** this task builds a native binary — it needs Xcode CLT, cmake, and network access on the Mac. If the sandbox blocks any step, stop and report; Awais can run the build script manually.

**Files:**
- Replace: `src-tauri/binaries/whisper-cli-aarch64-apple-darwin` (binary, not committed if .gitignored — check `git check-ignore`)
- Modify: `HOW_TO_RUN.md` (whisper-cli build section)
- Modify: `docs/manual-test.md` (add sync-accuracy recipe)

- [ ] **Step 1: Build current whisper.cpp with Core ML**

```bash
cd /private/tmp/claude-502/-Users-mohr-code-projects-yusaf-cut/*/scratchpad
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build -DWHISPER_COREML=1 -DWHISPER_COREML_ALLOW_FALLBACK=1
cmake --build build -j --config Release
```

Expected: `build/bin/whisper-cli` exists.

- [ ] **Step 2: Verify the new binary knows the DTW presets**

```bash
./build/bin/whisper-cli --help 2>&1 | grep -i dtw
```

Expected: a `-dtw MODEL` / `--dtw` line listing presets including `large.v3.turbo`. If `large.v3.turbo` is not listed, STOP — check `whisper.cpp` release notes before proceeding.

- [ ] **Step 3: Install as the sidecar and rebuild the app**

```bash
cp build/bin/whisper-cli \
  /Users/mohr/code/projects/yusaf-cut/src-tauri/binaries/whisper-cli-aarch64-apple-darwin
cd /Users/mohr/code/projects/yusaf-cut && npm run tauri:dev
```

- [ ] **Step 4: Manual sync-accuracy verification (the acceptance criteria)**

With the dev app running, transcribe a real clip ≥ 10 minutes using `large-v3-turbo` and verify each acceptance criterion from the spec:

1. Click a word near the START of the video → playback begins within ±50 ms of that word's onset.
2. Click words in the MIDDLE and at the very END → same accuracy; **no drift growth**.
3. During playback, the highlighted word matches what is being spoken.
4. Delete a sentence mid-video, export, and confirm the cut does not clip syllables.
5. **DTW interpretation check (Task 2 note):** if every word highlight/seek consistently lands one word LATE, the t_dtw boundary interpretation must be flipped — word start = own `t_dtw`, end = next token's. Fix `parse_whisper_json` accordingly and re-verify.

Record pass/fail per criterion in the commit message body of Step 6.

- [ ] **Step 5: Update HOW_TO_RUN.md and docs/manual-test.md**

In `HOW_TO_RUN.md`, update the whisper-cli build section to the commands from Step 1 and note: "whisper.cpp must be recent enough that `--dtw large.v3.turbo` is accepted (check with `whisper-cli --help | grep -i dtw`). Older binaries still work — the app detects the rejection and transcribes without DTW refinement."

In `docs/manual-test.md`, add a **"Word-sync accuracy"** section containing the 5-point checklist from Step 4 verbatim.

- [ ] **Step 6: Commit docs (and the binary if it is tracked)**

```bash
git add HOW_TO_RUN.md docs/manual-test.md
git check-ignore src-tauri/binaries/whisper-cli-aarch64-apple-darwin || \
  git add src-tauri/binaries/whisper-cli-aarch64-apple-darwin
git commit -m "chore: upgrade whisper-cli build docs for DTW preset support"
```

---

### Task 7: Version bump, changelog, architecture docs, final verification

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (version → `4.5.0`)
- Modify: `CHANGELOG.md`, `docs/architecture.md`, `CLAUDE.md` (transcription-flags note)

- [ ] **Step 1: Bump the three version fields to 4.5.0**

- [ ] **Step 2: Add CHANGELOG entry**

Under `## [Unreleased]`, insert a new section ABOVE `## [4.4.0]`:

```markdown
## [4.5.0] — <today's date>

### Added
- **DTW word-timestamp refinement for `large-v3` and `large-v3-turbo`** — the transcription pipeline now passes `--dtw large.v3` / `--dtw large.v3.turbo` and consumes the DTW-refined `t_dtw` token timestamps, bringing per-word accuracy from ~100 ms to ~20 ms. Fixes click-to-seek landing off-target, playback-highlight lag, and cumulative drift on long videos.
- **Silence-boundary snapping** — freshly transcribed word boundaries that fall inside an ffmpeg-detected silence are snapped to the silence edge (max 120 ms adjustment), so export cuts land in silence instead of clipping syllables. New pure module `src/lib/timestampSnap.ts`.
- Manual sync-accuracy test recipe in `docs/manual-test.md`.

### Changed
- `parse_whisper_json` prefers DTW timestamps when present and falls back to standard offsets, so older `whisper-cli` builds keep working.
- If the bundled `whisper-cli` rejects the `--dtw` preset, transcription retries once without DTW instead of failing.
```

- [ ] **Step 3: Update `docs/architecture.md` "Transcription engine" section**

Append to the flag list: `--dtw <preset>` — DTW cross-attention timestamp refinement (all models incl. large-v3/turbo). And after the flags: "After transcription, word boundaries are snapped to ffmpeg-silencedetect edges by `src/lib/timestampSnap.ts` (max 120 ms adjustment) so cuts always land in silence."

Also update the repo-root `CLAUDE.md` "Transcription engine" key-flags list with the same `--dtw` line.

- [ ] **Step 4: Full verification**

Run: `npm run check && npm test && npm run test:rust`
Expected: all PASS, zero warnings.

- [ ] **Step 5: Commit and push**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json CHANGELOG.md docs/architecture.md CLAUDE.md
git commit -m "chore: bump to 4.5.0; document DTW timestamp pipeline"
git push -u origin feature/dtw-word-sync
```

**Do NOT create a PR or merge** — Awais does that manually.
