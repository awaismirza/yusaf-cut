# Phase C: LLM Transcript Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix spellings and mis-heard words via a user-configured OpenAI-compatible LLM endpoint, with review-before-apply, without ever touching a timestamp (spec section C of `docs/superpowers/specs/2026-07-06-editing-accuracy-and-left-sidebar-design.md`).

**Architecture:** A Rust `polish_transcript` command chunks the word list (~120 words), prompts the endpoint per chunk, and validates responses with a strict substitution-only protocol (any violation discards the whole chunk). Corrections flow to a `polishStore` for review in a new Polish panel (Transcribe mode); accepting applies one undoable `projectStore` action that changes `Word.text` only.

**Tech Stack:** Rust (`reqwest` — already a dependency with the `json` feature), Tauri command + `polish:progress` events, Zustand (`persist` for settings), React panel, Vitest + cargo test.

## Global Constraints

- Branch: create `feature/llm-transcript-polish` **from `feature/left-sidebar-modes`** (Phase B's branch — the Polish panel lives in Phase B's Transcribe mode).
- Never mention Claude, AI, or AI assistance in commits, code comments, or docs. No Co-Authored-By tags. (UI copy may say "LLM" / "language model" — that describes the user-facing feature, not authorship.)
- Version bump to **4.7.0** in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (Task 7).
- Docs updated in the same commit as the code they describe.
- Prettier: double quotes, semicolons, trailing commas, 100-char width, 2-space indent. ESLint `--max-warnings=0`.
- Commit and push only — never create a PR or merge.
- **Protocol invariant:** only `Word.text` ever changes. `Word.start`/`Word.end` and segment structure are untouched by every code path in this phase.
- Default endpoint `http://localhost:11434/v1` (Ollama). API key optional. Temperature 0. Settings persist in localStorage, never in the `.scribe` project.

---

### Task 0: Branch setup

- [ ] **Step 1: Create the branch**

```bash
cd /Users/mohr/code/projects/yusaf-cut
git checkout feature/left-sidebar-modes
git checkout -b feature/llm-transcript-polish
```

---

### Task 1: Rust — chunking and the substitution-only validator (pure, TDD)

**Files:**
- Create: `src-tauri/src/commands/llm.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod llm;`)

**Interfaces (produced, used by Task 2):**

```rust
pub struct PolishWord { pub id: String, pub text: String }          // Deserialize + Clone
pub struct Correction { pub i: usize, pub word_id: String, pub from: String, pub to: String } // Serialize
pub const POLISH_CHUNK_SIZE: usize = 120;
fn chunk_ranges(total: usize, chunk: usize) -> Vec<std::ops::Range<usize>>;
fn extract_json_object(s: &str) -> Option<&str>;
pub fn validate_chunk(chunk_words: &[PolishWord], offset: usize, raw: &str) -> Result<Vec<Correction>, String>;
```

`validate_chunk` rules (spec): indices are **chunk-local 0-based** in the LLM response; global index = `offset + i`. Any violation → `Err` → the caller discards the entire chunk. Violations: unparseable JSON, index out of chunk range, `from` not exactly matching the current word text, empty `to`, whitespace in `to` (insertion/merge attempt), duplicate index. A correction where `to == from` is silently dropped (no-op, not a violation).

- [ ] **Step 1: Create the module skeleton with failing tests**

Create `src-tauri/src/commands/llm.rs`:

```rust
//! Transcript polish via an OpenAI-compatible chat-completions endpoint.
//!
//! The transcript is sent in chunks of indexed words; the model returns
//! 1-to-1 word substitutions as JSON. A strict validator rejects anything
//! that could change the word count — insertions, deletions, merges, splits —
//! so `Word.start`/`Word.end` and the EDL can never be affected. Only
//! `Word.text` is ever rewritten, and only after the user reviews.

use serde::{Deserialize, Serialize};

/// One transcript word sent for polishing (id + current text).
#[derive(Debug, Deserialize, Clone)]
pub struct PolishWord {
    pub id: String,
    pub text: String,
}

/// A validated 1-to-1 word substitution suggested by the model.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Correction {
    /// Global word index in the full transcript word list.
    pub i: usize,
    #[serde(rename = "wordId")]
    pub word_id: String,
    pub from: String,
    pub to: String,
}

pub const POLISH_CHUNK_SIZE: usize = 120;

/// Split `total` items into consecutive ranges of at most `chunk` items.
fn chunk_ranges(total: usize, chunk: usize) -> Vec<std::ops::Range<usize>> {
    let mut out = Vec::new();
    let mut start = 0;
    while start < total {
        let end = (start + chunk).min(total);
        out.push(start..end);
        start = end;
    }
    out
}

/// The model may wrap its JSON in prose or code fences — take the outermost
/// `{ … }` span.
fn extract_json_object(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    if end > start { Some(&s[start..=end]) } else { None }
}

#[derive(Debug, Deserialize)]
struct RawCorrections {
    corrections: Vec<RawCorrection>,
}

#[derive(Debug, Deserialize)]
struct RawCorrection {
    i: usize,
    from: String,
    to: String,
}

/// Validate one chunk's LLM response against the substitution-only protocol.
///
/// `Err` means the WHOLE chunk is discarded (spec rule): a model that breaks
/// the protocol once in a chunk cannot be trusted for that chunk at all.
pub fn validate_chunk(
    chunk_words: &[PolishWord],
    offset: usize,
    raw: &str,
) -> Result<Vec<Correction>, String> {
    let json_str = extract_json_object(raw).ok_or("no JSON object in response")?;
    let parsed: RawCorrections =
        serde_json::from_str(json_str).map_err(|e| format!("bad JSON: {e}"))?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for c in parsed.corrections {
        let word = chunk_words
            .get(c.i)
            .ok_or_else(|| format!("index {} beyond chunk", c.i))?;
        if c.from != word.text {
            return Err(format!("from mismatch at index {}", c.i));
        }
        let to = c.to.trim();
        if to.is_empty() {
            return Err(format!("empty replacement at index {}", c.i));
        }
        if to.chars().any(|ch| ch.is_whitespace()) {
            return Err(format!("multi-word replacement at index {}", c.i));
        }
        if !seen.insert(c.i) {
            return Err(format!("duplicate index {}", c.i));
        }
        if to == word.text {
            continue; // no-op suggestion — drop silently
        }
        out.push(Correction {
            i: offset + c.i,
            word_id: word.id.clone(),
            from: c.from,
            to: to.to_string(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(texts: &[&str]) -> Vec<PolishWord> {
        texts
            .iter()
            .enumerate()
            .map(|(i, t)| PolishWord { id: format!("id{i}"), text: (*t).to_string() })
            .collect()
    }

    #[test]
    fn chunk_ranges_splits_correctly() {
        assert!(chunk_ranges(0, 120).is_empty());
        assert_eq!(chunk_ranges(120, 120), vec![0..120]);
        assert_eq!(chunk_ranges(121, 120), vec![0..120, 120..121]);
        assert_eq!(chunk_ranges(5, 2), vec![0..2, 2..4, 4..5]);
    }

    #[test]
    fn accepts_a_valid_substitution_and_offsets_the_index() {
        let w = words(&["Hello", "wrld"]);
        let raw = r#"{"corrections":[{"i":1,"from":"wrld","to":"world"}]}"#;
        let out = validate_chunk(&w, 240, raw).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].i, 241);
        assert_eq!(out[0].word_id, "id1");
        assert_eq!(out[0].to, "world");
    }

    #[test]
    fn extracts_json_from_prose_and_code_fences() {
        let w = words(&["wrld"]);
        let raw = "Sure! Here are the fixes:\n```json\n{\"corrections\":[{\"i\":0,\"from\":\"wrld\",\"to\":\"world\"}]}\n```";
        assert_eq!(validate_chunk(&w, 0, raw).unwrap().len(), 1);
    }

    #[test]
    fn drops_noop_corrections_silently() {
        let w = words(&["fine"]);
        let raw = r#"{"corrections":[{"i":0,"from":"fine","to":"fine"}]}"#;
        assert!(validate_chunk(&w, 0, raw).unwrap().is_empty());
    }

    #[test]
    fn rejects_out_of_range_index() {
        let w = words(&["a"]);
        let raw = r#"{"corrections":[{"i":5,"from":"a","to":"b"}]}"#;
        assert!(validate_chunk(&w, 0, raw).is_err());
    }

    #[test]
    fn rejects_from_mismatch() {
        let w = words(&["colonel"]);
        let raw = r#"{"corrections":[{"i":0,"from":"kernel","to":"colonel"}]}"#;
        assert!(validate_chunk(&w, 0, raw).is_err());
    }

    #[test]
    fn rejects_multi_word_replacement() {
        let w = words(&["gonna"]);
        let raw = r#"{"corrections":[{"i":0,"from":"gonna","to":"going to"}]}"#;
        assert!(validate_chunk(&w, 0, raw).is_err());
    }

    #[test]
    fn rejects_empty_replacement_and_duplicates_and_garbage() {
        let w = words(&["a", "b"]);
        assert!(validate_chunk(&w, 0, r#"{"corrections":[{"i":0,"from":"a","to":""}]}"#).is_err());
        assert!(validate_chunk(
            &w,
            0,
            r#"{"corrections":[{"i":0,"from":"a","to":"x"},{"i":0,"from":"a","to":"y"}]}"#
        )
        .is_err());
        assert!(validate_chunk(&w, 0, "no json here at all").is_err());
        assert!(validate_chunk(&w, 0, "{broken json}").is_err());
    }
}
```

Add `pub mod llm;` to `src-tauri/src/commands/mod.rs` (alphabetical position among the existing `pub mod` lines).

- [ ] **Step 2: Run the tests**

Run: `cd src-tauri && cargo test llm`
Expected: PASS (9 tests). (Written together with the implementation since the module is new — the test cases above ARE the protocol specification.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/llm.rs src-tauri/src/commands/mod.rs
git commit -m "feat: add substitution-only validation for transcript polish"
```

---

### Task 2: Rust — HTTP client, `polish_transcript` + `llm_list_models` commands

**Files:**
- Modify: `src-tauri/src/commands/llm.rs`
- Modify: `src-tauri/src/jobs.rs` (`JobKind` enum ~line 44 and `as_str` ~line 51)
- Modify: `src-tauri/src/lib.rs` (register the two commands in `generate_handler!` ~line 38)

**Interfaces:**
- Produces (consumed by Task 3's ipc wrappers):
  - Command `llm_list_models(base_url: String, api_key: Option<String>) -> Result<Vec<String>, String>`
  - Command `polish_transcript(app, state, opts: PolishOpts) -> Result<Vec<Correction>, String>` where `PolishOpts { base_url, api_key, model, words }` (camelCase over the wire)
  - Event `polish:progress` payload `{ "done": usize, "total": usize }` after each chunk
  - `JobKind::Polish` with wire string `"polish"`

- [ ] **Step 1: Add `JobKind::Polish`**

In `src-tauri/src/jobs.rs`, add `Polish,` to the `JobKind` enum and `JobKind::Polish => "polish",` to its `as_str` match.

Run: `cd src-tauri && cargo build` — expect success (exhaustive matches elsewhere would surface here; fix any by adding the `Polish` arm following the pattern of `Snapshot`).

- [ ] **Step 2: Add opts, prompt, HTTP helper, and the two commands**

Append to `src-tauri/src/commands/llm.rs`:

```rust
use crate::AppState;
use crate::jobs::JobKind;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolishOpts {
    /// OpenAI-compatible base URL, e.g. "http://localhost:11434/v1".
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    /// The full transcript word list, in timeline order.
    pub words: Vec<PolishWord>,
}

const POLISH_SYSTEM_PROMPT: &str = "You are a meticulous transcript proofreader. \
You receive a numbered list of words from an automatic speech transcription. \
Fix ONLY clear transcription errors: misspellings, wrong homophones, garbled words, \
and misheard proper nouns. Do NOT rephrase, do NOT change style or grammar choices, \
do NOT merge or split words. Preserve each word's capitalisation pattern and any \
leading/trailing punctuation. Reply with JSON only, no prose:\n\
{\"corrections\":[{\"i\":<number>,\"from\":\"<exact original>\",\"to\":\"<replacement>\"}]}\n\
Each replacement must be a single word with no spaces. \
If nothing needs fixing, reply {\"corrections\":[]}.";

/// Build the user message for one chunk: numbered words plus unnumbered
/// context so the model can resolve homophones across chunk boundaries.
fn build_chunk_prompt(all: &[PolishWord], range: &std::ops::Range<usize>) -> String {
    const CONTEXT: usize = 15;
    let before_start = range.start.saturating_sub(CONTEXT);
    let before: Vec<&str> = all[before_start..range.start].iter().map(|w| w.text.as_str()).collect();
    let after_end = (range.end + CONTEXT).min(all.len());
    let after: Vec<&str> = all[range.end..after_end].iter().map(|w| w.text.as_str()).collect();

    let mut prompt = String::new();
    if !before.is_empty() {
        prompt.push_str(&format!("Context before (do not correct): {}\n\n", before.join(" ")));
    }
    prompt.push_str("Words:\n");
    for (local, w) in all[range.clone()].iter().enumerate() {
        prompt.push_str(&format!("{}: {}\n", local, w.text));
    }
    if !after.is_empty() {
        prompt.push_str(&format!("\nContext after (do not correct): {}", after.join(" ")));
    }
    prompt
}

/// POST a chat completion and return the assistant message content.
async fn chat_complete(
    client: &reqwest::Client,
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    user_content: &str,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "temperature": 0,
        "messages": [
            { "role": "system", "content": POLISH_SYSTEM_PROMPT },
            { "role": "user", "content": user_content }
        ]
    });
    let mut req = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(180))
        .json(&body);
    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }
    let resp = req.send().await.map_err(|e| format!("LLM request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("LLM endpoint returned {status}: {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid LLM response JSON: {e}"))?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "LLM response missing choices[0].message.content".to_string())
}

/// List model ids from `GET {base_url}/models` (OpenAI-compatible).
#[tauri::command]
pub async fn llm_list_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(key) = &api_key {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }
    let resp = req.send().await.map_err(|e| format!("cannot reach endpoint: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("endpoint returned {status}: {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid models JSON: {e}"))?;
    let models = v["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(models)
}

/// Polish the transcript chunk-by-chunk. Chunks whose response violates the
/// substitution-only protocol are skipped (their words stay untouched) —
/// a partial result is more useful than a failed run.
#[tauri::command]
pub async fn polish_transcript(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: PolishOpts,
) -> Result<Vec<Correction>, String> {
    let job = state
        .jobs
        .create(&app, JobKind::Polish, format!("Polishing transcript — {}", opts.model))
        .await;
    job.mark_running().await;

    let client = reqwest::Client::new();
    let ranges = chunk_ranges(opts.words.len(), POLISH_CHUNK_SIZE);
    let total = ranges.len();
    let mut corrections = Vec::new();
    let mut failed_chunks = 0usize;

    for (done, range) in ranges.into_iter().enumerate() {
        let prompt = build_chunk_prompt(&opts.words, &range);
        let result = chat_complete(
            &client,
            &opts.base_url,
            opts.api_key.as_deref(),
            &opts.model,
            &prompt,
        )
        .await;
        match result {
            Ok(content) => match validate_chunk(&opts.words[range.clone()], range.start, &content) {
                Ok(mut chunk_corrections) => corrections.append(&mut chunk_corrections),
                Err(reason) => {
                    failed_chunks += 1;
                    log::warn!("polish chunk {done} discarded: {reason}");
                }
            },
            Err(e) => {
                // A transport-level failure on the FIRST chunk means the
                // endpoint is misconfigured — fail fast so the user sees it.
                if done == 0 {
                    job.mark_failed(e.clone()).await;
                    return Err(e);
                }
                failed_chunks += 1;
                log::warn!("polish chunk {done} request failed: {e}");
            }
        }
        app.emit(
            "polish:progress",
            serde_json::json!({ "done": done + 1, "total": total }),
        )
        .ok();
        job.set_progress((done + 1) as f64 / total.max(1) as f64, None).await;
    }

    if failed_chunks > 0 {
        log::warn!("polish finished with {failed_chunks}/{total} chunks discarded");
    }
    job.mark_completed().await;
    Ok(corrections)
}
```

Add tests for `build_chunk_prompt` to the `tests` module:

```rust
    #[test]
    fn chunk_prompt_numbers_words_locally_and_adds_context() {
        let w = words(&["a", "b", "c", "d", "e"]);
        let prompt = build_chunk_prompt(&w, &(2..4));
        assert!(prompt.contains("0: c"));
        assert!(prompt.contains("1: d"));
        assert!(prompt.contains("Context before (do not correct): a b"));
        assert!(prompt.contains("Context after (do not correct): e"));
        assert!(!prompt.contains("2: "));
    }

    #[test]
    fn chunk_prompt_omits_empty_context_sections() {
        let w = words(&["a", "b"]);
        let prompt = build_chunk_prompt(&w, &(0..2));
        assert!(!prompt.contains("Context before"));
        assert!(!prompt.contains("Context after"));
    }
```

- [ ] **Step 3: Register the commands**

In `src-tauri/src/lib.rs` `generate_handler!`, add after the pauses line:

```rust
            commands::llm::llm_list_models,
            commands::llm::polish_transcript,
```

- [ ] **Step 4: Run all Rust tests**

Run: `cd src-tauri && cargo test`
Expected: PASS — 11 llm tests + no regressions.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/llm.rs src-tauri/src/jobs.rs src-tauri/src/lib.rs
git commit -m "feat: add transcript polish and model-listing commands"
```

---

### Task 3: ipc.ts wrappers

**Files:**
- Modify: `src/lib/ipc.ts`

**Interfaces (produced, consumed by Tasks 4-6):**

- [ ] **Step 1: Add the wrappers**

In `src/lib/ipc.ts`, change the `JobKind` union (~line 225):

```ts
export type JobKind = "export" | "transcribe" | "download-model" | "snapshot" | "polish";
```

Append a new section before the pauses section:

```ts
// ---------------------------------------------------------------------------
// Transcript polish (OpenAI-compatible LLM endpoint)
// ---------------------------------------------------------------------------

/** One transcript word sent for polishing. */
export interface PolishWordIn {
  id: string;
  text: string;
}

/** A validated 1-to-1 word substitution suggested by the model. */
export interface WordCorrection {
  /** Global index into the word list that was sent. */
  i: number;
  wordId: string;
  from: string;
  to: string;
}

export interface PolishOptions {
  /** OpenAI-compatible base URL, e.g. "http://localhost:11434/v1" (Ollama). */
  baseUrl: string;
  /** Optional bearer token — leave undefined for local servers. */
  apiKey?: string;
  model: string;
  words: PolishWordIn[];
}

/** List model ids from the endpoint's /models route. Doubles as a connection test. */
export function llmListModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  return invoke<string[]>("llm_list_models", { baseUrl, apiKey: apiKey ?? null });
}

/**
 * Run the polish pass over the full word list. Resolves with validated
 * substitution-only corrections; subscribe to `onPolishProgress` first for a
 * per-chunk progress bar. Only `Word.text` can ever be affected by applying
 * these — timestamps are not part of the protocol.
 */
export function polishTranscript(opts: PolishOptions): Promise<WordCorrection[]> {
  return invoke<WordCorrection[]>("polish_transcript", { opts });
}

export interface PolishProgress {
  done: number;
  total: number;
}

export function onPolishProgress(handler: (p: PolishProgress) => void): Promise<UnlistenFn> {
  return listen<PolishProgress>("polish:progress", (e) => handler(e.payload));
}
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat: add polish command wrappers to ipc layer"
```

---

### Task 4: `projectStore.applyWordCorrections` (one undoable batch)

**Files:**
- Modify: `src/stores/projectStore.ts`
- Test: `tests/applyWordCorrections.test.ts`

**Interfaces:**
- Produces: `applyWordCorrections(corrections: Array<{ wordId: string; to: string }>): number` — replaces `Word.text` by id in a single `set()` (one zundo step), returns the count applied. Never touches `start`/`end`.

- [ ] **Step 1: Write the failing test**

Create `tests/applyWordCorrections.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { newProject } from "@/lib/edl";
import { useProjectStore } from "@/stores/projectStore";

function seedProject() {
  const project = newProject("Test");
  project.segments = [
    {
      id: "seg1",
      mediaId: "m1",
      sourceIn: 0,
      sourceOut: 2,
      words: [
        { id: "w1", text: "helo", start: 0.0, end: 0.5, confidence: 0.9 },
        { id: "w2", text: "wrld", start: 0.5, end: 1.0, confidence: 0.8 },
        { id: "w3", text: "fine", start: 1.0, end: 1.5, confidence: 0.99 },
      ],
    },
  ];
  useProjectStore.setState({ project, dirty: false });
}

describe("applyWordCorrections", () => {
  beforeEach(seedProject);

  it("replaces text by word id and reports the count", () => {
    const n = useProjectStore.getState().applyWordCorrections([
      { wordId: "w1", to: "hello" },
      { wordId: "w2", to: "world" },
    ]);
    expect(n).toBe(2);
    const words = useProjectStore.getState().project.segments[0].words;
    expect(words.map((w) => w.text)).toEqual(["hello", "world", "fine"]);
    expect(useProjectStore.getState().dirty).toBe(true);
  });

  it("never touches timestamps", () => {
    const before = useProjectStore.getState().project.segments[0].words.map((w) => [w.start, w.end]);
    useProjectStore.getState().applyWordCorrections([{ wordId: "w1", to: "hello" }]);
    const after = useProjectStore.getState().project.segments[0].words.map((w) => [w.start, w.end]);
    expect(after).toEqual(before);
  });

  it("ignores unknown ids and no-op replacements", () => {
    const n = useProjectStore.getState().applyWordCorrections([
      { wordId: "missing", to: "x" },
      { wordId: "w3", to: "fine" },
    ]);
    expect(n).toBe(0);
    expect(useProjectStore.getState().dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/applyWordCorrections.test.ts`
Expected: FAIL — `applyWordCorrections` is not a function.

- [ ] **Step 3: Implement the action**

In `src/stores/projectStore.ts`, add to the `ProjectState` interface (after `replaceText`):

```ts
  /**
   * Replace the text of specific words by id — the apply step of the polish
   * review flow. One store update = one undo step, so ⌘Z reverts the whole
   * batch. Timestamps and segment structure are never touched.
   * Returns the count of words actually changed.
   */
  applyWordCorrections: (corrections: Array<{ wordId: string; to: string }>) => number;
```

And the implementation (after the `replaceText` implementation):

```ts
      applyWordCorrections: (corrections) => {
        if (corrections.length === 0) return 0;
        const byId = new Map(corrections.map((c) => [c.wordId, c.to]));
        let applied = 0;
        const project = _get().project;
        const nextSegments = project.segments.map((seg) => ({
          ...seg,
          words: seg.words.map((w) => {
            const to = byId.get(w.id);
            if (to === undefined || to === w.text) return w;
            applied++;
            return { ...w, text: to };
          }),
        }));
        if (applied === 0) return 0;
        set({
          project: { ...project, segments: nextSegments, updatedAt: new Date().toISOString() },
          dirty: true,
        });
        return applied;
      },
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/applyWordCorrections.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/projectStore.ts tests/applyWordCorrections.test.ts
git commit -m "feat: add batch word-text correction action to project store"
```

---

### Task 5: `polishStore` — settings (persisted) + review state

**Files:**
- Create: `src/stores/polishStore.ts`
- Test: `tests/polishStore.test.ts`

**Interfaces (produced, consumed by Task 6):**
- `PolishSettings { baseUrl: string; apiKey: string; model: string; autoRun: boolean }` — persisted under localStorage key `yusafcut.polish` (settings only). `autoRun` (default `false`) triggers a polish run automatically after each successful transcription; review is still required before anything applies.
- `status: "idle" | "running" | "review"`, `progress`, `corrections: ReviewCorrection[]` (`WordCorrection & { accepted: boolean }`).
- Actions: `setSettings(patch)`, `setAvailableModels`, `startRun()`, `setProgress(done,total)`, `finishRun(corrections)`, `toggleCorrection(i)`, `setAllAccepted(bool)`, `reset()`.

- [ ] **Step 1: Write the failing tests**

Create `tests/polishStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePolishStore } from "@/stores/polishStore";

const CORRECTIONS = [
  { i: 3, wordId: "w3", from: "wrld", to: "world" },
  { i: 9, wordId: "w9", from: "helo", to: "hello" },
];

describe("polishStore", () => {
  beforeEach(() => usePolishStore.getState().reset());

  it("defaults to the Ollama endpoint with auto-run off", () => {
    expect(usePolishStore.getState().settings.baseUrl).toBe("http://localhost:11434/v1");
    expect(usePolishStore.getState().settings.autoRun).toBe(false);
  });

  it("finishRun enters review with all corrections accepted", () => {
    usePolishStore.getState().startRun();
    usePolishStore.getState().finishRun(CORRECTIONS);
    const s = usePolishStore.getState();
    expect(s.status).toBe("review");
    expect(s.corrections.every((c) => c.accepted)).toBe(true);
  });

  it("finishRun with no corrections returns to idle", () => {
    usePolishStore.getState().startRun();
    usePolishStore.getState().finishRun([]);
    expect(usePolishStore.getState().status).toBe("idle");
  });

  it("toggles a single correction by global index", () => {
    usePolishStore.getState().finishRun(CORRECTIONS);
    usePolishStore.getState().toggleCorrection(3);
    const s = usePolishStore.getState();
    expect(s.corrections.find((c) => c.i === 3)?.accepted).toBe(false);
    expect(s.corrections.find((c) => c.i === 9)?.accepted).toBe(true);
  });

  it("setAllAccepted flips every correction", () => {
    usePolishStore.getState().finishRun(CORRECTIONS);
    usePolishStore.getState().setAllAccepted(false);
    expect(usePolishStore.getState().corrections.every((c) => !c.accepted)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npx vitest run tests/polishStore.test.ts` → FAIL (module missing).

Create `src/stores/polishStore.ts`:

```ts
/**
 * Polish feature state: endpoint settings (persisted to localStorage — never
 * into the .scribe project) and the transient run/review state.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WordCorrection } from "@/lib/ipc";

export interface PolishSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Run polish automatically after each successful transcription (review still required). */
  autoRun: boolean;
}

export type PolishStatus = "idle" | "running" | "review";

export interface ReviewCorrection extends WordCorrection {
  accepted: boolean;
}

interface PolishState {
  settings: PolishSettings;
  status: PolishStatus;
  progress: { done: number; total: number } | null;
  corrections: ReviewCorrection[];
  availableModels: string[];

  setSettings: (patch: Partial<PolishSettings>) => void;
  setAvailableModels: (models: string[]) => void;
  startRun: () => void;
  setProgress: (done: number, total: number) => void;
  finishRun: (corrections: WordCorrection[]) => void;
  toggleCorrection: (i: number) => void;
  setAllAccepted: (accepted: boolean) => void;
  reset: () => void;
}

export const usePolishStore = create<PolishState>()(
  persist(
    (set) => ({
      settings: { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "", autoRun: false },
      status: "idle",
      progress: null,
      corrections: [],
      availableModels: [],

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setAvailableModels: (models) => set({ availableModels: models }),
      startRun: () => set({ status: "running", progress: { done: 0, total: 0 }, corrections: [] }),
      setProgress: (done, total) => set({ progress: { done, total } }),
      finishRun: (corrections) =>
        set({
          status: corrections.length > 0 ? "review" : "idle",
          progress: null,
          corrections: corrections.map((c) => ({ ...c, accepted: true })),
        }),
      toggleCorrection: (i) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            c.i === i ? { ...c, accepted: !c.accepted } : c,
          ),
        })),
      setAllAccepted: (accepted) =>
        set((s) => ({ corrections: s.corrections.map((c) => ({ ...c, accepted })) })),
      reset: () => set({ status: "idle", progress: null, corrections: [] }),
    }),
    {
      name: "yusafcut.polish",
      partialize: (s) => ({ settings: s.settings }),
    },
  ),
);
```

Run: `npx vitest run tests/polishStore.test.ts` → PASS (5 tests). (If `persist` warns about missing storage in the node test environment, silence it by stubbing localStorage in the test's `beforeEach` exactly as in `tests/recentProjects.test.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/stores/polishStore.ts tests/polishStore.test.ts
git commit -m "feat: add polish settings and review state store"
```

---

### Task 6: Polish panel UI, inline review highlight, registry entry

**Files:**
- Create: `src/components/editor/sidebar/panels/PolishPanel.tsx`
- Modify: `src/components/editor/sidebar/registry.tsx` (add entry)
- Modify: `src/styles/globals.css` (highlight style)

- [ ] **Step 1: Create the panel**

`src/components/editor/sidebar/panels/PolishPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Check, PlugZap, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { llmListModels, onPolishProgress, polishTranscript, type PolishWordIn } from "@/lib/ipc";
import { usePolishStore } from "@/stores/polishStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUIStore } from "@/stores/uiStore";

const SUGGESTED_MODELS = "Suggested: qwen3:14b · qwen2.5:14b · llama3.1:8b (Ollama)";

/**
 * Run the polish pass using the persisted settings. A plain function (stores
 * via getState) so Toolbar can trigger it for the auto-run-after-transcription
 * setting; the panel's button uses the same path.
 */
export async function runPolish(): Promise<void> {
  const { settings } = usePolishStore.getState();
  const pushToast = useUIStore.getState().pushToast;
  const project = useProjectStore.getState().project;
  const words: PolishWordIn[] = project.segments.flatMap((seg) =>
    seg.words.map((w) => ({ id: w.id, text: w.text })),
  );
  if (words.length === 0) {
    pushToast({ title: "Nothing to polish", description: "Transcribe first." });
    return;
  }
  if (!settings.model) {
    pushToast({ title: "Pick a model", description: "Test the connection to list models." });
    return;
  }
  if (usePolishStore.getState().status === "running") return;
  usePolishStore.getState().startRun();
  const unlisten = await onPolishProgress((p) =>
    usePolishStore.getState().setProgress(p.done, p.total),
  );
  try {
    const result = await polishTranscript({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey || undefined,
      model: settings.model,
      words,
    });
    usePolishStore.getState().finishRun(result);
    pushToast(
      result.length > 0
        ? {
            title: `${result.length} suggested correction${result.length === 1 ? "" : "s"}`,
            description: "Review in the Polish panel, then apply.",
          }
        : { title: "No corrections suggested", description: "The transcript looks clean." },
    );
  } catch (err) {
    usePolishStore.getState().reset();
    pushToast({ title: "Polish failed", description: String(err), variant: "destructive" });
  } finally {
    unlisten();
  }
}

export function PolishPanel() {
  const settings = usePolishStore((s) => s.settings);
  const setSettings = usePolishStore((s) => s.setSettings);
  const status = usePolishStore((s) => s.status);
  const progress = usePolishStore((s) => s.progress);
  const corrections = usePolishStore((s) => s.corrections);
  const availableModels = usePolishStore((s) => s.availableModels);
  const hasTranscript = useProjectStore((s) =>
    s.project.segments.some((seg) => seg.words.length > 0),
  );
  const pushToast = useUIStore((s) => s.pushToast);
  const [testing, setTesting] = useState(false);

  // Inline review highlight: mark pending words in the transcript DOM.
  // WordNode renders each word with a stable data-word-id attribute; this is
  // a display-only overlay, removed on cleanup, never part of the document.
  useEffect(() => {
    if (status !== "review") return;
    const marked: HTMLElement[] = [];
    for (const c of corrections) {
      const el = document.querySelector<HTMLElement>(`[data-word-id="${c.wordId}"]`);
      if (!el) continue;
      el.classList.toggle("word-pending-correction", c.accepted);
      el.title = `${c.from} → ${c.to}`;
      marked.push(el);
    }
    return () => {
      for (const el of marked) {
        el.classList.remove("word-pending-correction");
        el.removeAttribute("title");
      }
    };
  }, [status, corrections]);

  async function handleTestConnection() {
    setTesting(true);
    try {
      const models = await llmListModels(settings.baseUrl, settings.apiKey || undefined);
      usePolishStore.getState().setAvailableModels(models);
      if (models.length > 0 && !settings.model) setSettings({ model: models[0] });
      pushToast({
        title: `Connected — ${models.length} model${models.length === 1 ? "" : "s"} available`,
      });
    } catch (err) {
      pushToast({ title: "Connection failed", description: String(err), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  function handleApply() {
    const accepted = corrections.filter((c) => c.accepted);
    const applied = useProjectStore
      .getState()
      .applyWordCorrections(accepted.map((c) => ({ wordId: c.wordId, to: c.to })));
    usePolishStore.getState().reset();
    pushToast({
      title: `Applied ${applied} correction${applied === 1 ? "" : "s"}`,
      description: "Use ⌘Z to revert the whole batch.",
    });
  }

  const acceptedCount = corrections.filter((c) => c.accepted).length;

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">LLM endpoint</p>
        <input
          className="polish-input"
          type="text"
          placeholder="http://localhost:11434/v1"
          value={settings.baseUrl}
          onChange={(e) => setSettings({ baseUrl: e.target.value })}
        />
        <input
          className="polish-input"
          type="password"
          placeholder="API key (optional)"
          value={settings.apiKey}
          onChange={(e) => setSettings({ apiKey: e.target.value })}
        />
        {availableModels.length > 0 ? (
          <select
            className="polish-input"
            value={settings.model}
            onChange={(e) => setSettings({ model: e.target.value })}
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="polish-input"
            type="text"
            placeholder="model name, e.g. qwen3:14b"
            value={settings.model}
            onChange={(e) => setSettings({ model: e.target.value })}
          />
        )}
        <Button
          variant="outline"
          className="w-full gap-2"
          disabled={testing}
          onClick={() => void handleTestConnection()}
        >
          <PlugZap className="h-4 w-4" />
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <p className="inspector-hint">{SUGGESTED_MODELS}</p>
      </div>

      <div className="inspector-divider" />

      <div className="inspector-section">
        <p className="inspector-section-label">Polish</p>
        <Button
          className="w-full gap-2"
          disabled={!hasTranscript || status === "running"}
          onClick={() => void runPolish()}
        >
          <Sparkles className="h-4 w-4" />
          {status === "running"
            ? progress && progress.total > 0
              ? `Polishing… ${progress.done}/${progress.total}`
              : "Polishing…"
            : "Polish transcript"}
        </Button>
        <label className="polish-review-row">
          <input
            type="checkbox"
            checked={settings.autoRun}
            onChange={(e) => setSettings({ autoRun: e.target.checked })}
          />
          Auto-run after each transcription
        </label>
        <p className="inspector-hint">
          Fixes spelling and misheard words only. Timing is untouched — sync accuracy comes from
          transcription, not polish. Suggestions always require review before applying.
        </p>
      </div>

      {status === "review" && (
        <>
          <div className="inspector-divider" />
          <div className="inspector-section">
            <p className="inspector-section-label">
              Review ({acceptedCount}/{corrections.length} accepted)
            </p>
            <div className="polish-review-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => usePolishStore.getState().setAllAccepted(true)}
              >
                <Check className="h-4 w-4" /> All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => usePolishStore.getState().setAllAccepted(false)}
              >
                <X className="h-4 w-4" /> None
              </Button>
            </div>
            <div className="polish-review-list">
              {corrections.map((c) => (
                <label key={c.i} className="polish-review-row">
                  <input
                    type="checkbox"
                    checked={c.accepted}
                    onChange={() => usePolishStore.getState().toggleCorrection(c.i)}
                  />
                  <span className="polish-review-from">{c.from}</span>
                  <span className="polish-review-arrow">→</span>
                  <span className="polish-review-to">{c.to}</span>
                </label>
              ))}
            </div>
            <Button className="w-full gap-2" disabled={acceptedCount === 0} onClick={handleApply}>
              <Check className="h-4 w-4" />
              Apply {acceptedCount} correction{acceptedCount === 1 ? "" : "s"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => usePolishStore.getState().reset()}
            >
              Discard suggestions
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the panel (Transcribe mode)**

In `src/components/editor/sidebar/registry.tsx`, add `Sparkles` to the lucide import, import the panel, and append after the `transcribe` entry:

```tsx
  {
    id: "polish",
    icon: Sparkles,
    label: "Polish",
    modes: ["transcribe"],
    component: PolishPanel,
  },
```

Update `tests/panelRegistry.test.ts` expected ids: `["media", "transcribe", "polish"]` for transcribe mode.

- [ ] **Step 3: Add the styles**

Append to `src/styles/globals.css`:

```css
/* ── Polish panel ── */

.polish-input {
  width: 100%;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 12px;
}

.polish-input:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -1px;
}

.polish-review-actions {
  display: flex;
  gap: 4px;
}

.polish-review-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
}

.polish-review-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.polish-review-row:hover {
  background: hsl(var(--muted) / 0.5);
}

.polish-review-from {
  color: hsl(var(--muted-foreground));
  text-decoration: line-through;
}

.polish-review-arrow {
  color: hsl(var(--muted-foreground));
}

.polish-review-to {
  font-weight: 600;
}

/* Word pending an accepted polish correction (review overlay). */
.word-pending-correction {
  background: hsl(45 90% 55% / 0.18);
  border-radius: 2px;
  text-decoration: underline wavy hsl(45 90% 55%);
  text-underline-offset: 2px;
}
```

- [ ] **Step 3b: Wire the auto-run setting into transcription**

In `src/components/Toolbar/Toolbar.tsx`, add imports:

```ts
import { runPolish } from "@/components/editor/sidebar/panels/PolishPanel";
import { usePolishStore } from "@/stores/polishStore";
```

In `startTranscribe`, right after the `autoDetectPauses` call in the success path, add:

```ts
      // Optional auto-polish after transcription (default off). Suggestions
      // still land in the review list — nothing is applied silently.
      const polishSettings = usePolishStore.getState().settings;
      if (polishSettings.autoRun && polishSettings.model && totalWords > 0) {
        void runPolish();
      }
```

- [ ] **Step 4: Verify (typecheck, tests, live)**

Run: `npm run check && npm test`
Expected: PASS (including the updated registry test).

Live check with `npm run tauri:dev` and a running Ollama (`ollama serve`, any small model pulled): Transcribe mode → Polish panel → Test connection lists models → transcribe a short clip → Polish transcript → corrections appear with inline yellow highlights on affected words → uncheck one → Apply → transcript updates, one ⌘Z reverts the batch. If no Ollama is available, verify the failure path: unreachable endpoint → destructive toast, status back to idle.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/sidebar/panels/PolishPanel.tsx \
  src/components/editor/sidebar/registry.tsx tests/panelRegistry.test.ts \
  src/styles/globals.css src/components/Toolbar/Toolbar.tsx
git commit -m "feat: add transcript polish panel with review-before-apply flow"
```

---

### Task 7: Version bump, changelog, docs

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (→ `4.7.0`)
- Modify: `CHANGELOG.md`, `docs/architecture.md`, `README.md`, `docs/yusafcut-spec.md`

- [ ] **Step 1: Bump the three version fields to 4.7.0**

- [ ] **Step 2: CHANGELOG entry** (above `[4.6.0]`, below `[Unreleased]`):

```markdown
## [4.7.0] — <today's date>

### Added
- **Transcript polish via any OpenAI-compatible LLM endpoint** — new Polish panel (Transcribe mode) with endpoint URL, optional API key, model picker fed by the endpoint's /models route, and a connection test. Default endpoint is a local Ollama (`http://localhost:11434/v1`); suggested models: qwen3:14b, qwen2.5:14b, llama3.1:8b.
- **Review-before-apply corrections** — suggestions arrive as a checklist (old → new) with inline highlights in the transcript; accept all, reject all, or toggle individually. Applying is a single undoable step (⌘Z reverts the whole batch).
- **Substitution-only protocol** — the Rust validator rejects any model response that would insert, delete, merge, split, or reorder words; violating chunks are discarded wholesale. Only `Word.text` can change — timestamps and the EDL are untouched by construction, so polish can never cause sync issues.
- New commands `polish_transcript` (chunked, with `polish:progress` events and a jobs-queue entry) and `llm_list_models`.
- Optional "Auto-run after each transcription" setting (default off) — suggestions still require review before applying.

### Notes
- Polish improves text accuracy; timestamp accuracy comes from the transcription pipeline (v4.5.0 DTW refinement). Words whisper never emitted cannot be recovered — there is no timestamp to attach text to.
```

- [ ] **Step 3: Update the docs**

- `docs/architecture.md`: add `llm` to the Rust commands list in the layered diagram and a short "Transcript polish" subsection stating the substitution-only protocol and that settings live in localStorage, corrections change `Word.text` only.
- `README.md`: add the polish feature to the feature table (status: shipped, local-first — user-configured endpoint).
- `docs/yusafcut-spec.md`: if a section covers transcription accuracy/AI features, append the polish behaviour; otherwise skip.

- [ ] **Step 4: Full verification**

Run: `npm run ci`
Expected: all suites PASS.

- [ ] **Step 5: Commit and push**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json CHANGELOG.md docs/architecture.md README.md docs/yusafcut-spec.md
git commit -m "chore: bump to 4.7.0; document transcript polish"
git push -u origin feature/llm-transcript-polish
```

**Do NOT create a PR or merge** — Awais does that manually.
