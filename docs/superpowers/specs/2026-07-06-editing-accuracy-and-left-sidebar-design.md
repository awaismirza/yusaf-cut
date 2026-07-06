# Editing Accuracy & Left Sidebar Redesign — Design

**Date:** 2026-07-06
**Status:** Approved
**Builds on:** `feature/right-sidebar-ui` branch (v4.4.0 right-sidebar shell) and
`docs/superpowers/specs/2026-06-28-right-sidebar-ui-refactor-design.md`

## Problem

Text-based editing is only as good as its word timestamps and its transcript text.
Today both fall short:

1. **Sync** — word timestamps from `large-v3-turbo` are imprecise: clicking a word
   seeks to the wrong spot, the playback highlight lags, drift grows over long
   videos, and export cuts clip audio. Root cause: the bundled `whisper-cli` is too
   old to apply DTW timestamp refinement to `large-v3` / `large-v3-turbo`
   (`dtw_preset_for_model` returns `None` for both), so those models ship raw,
   unrefined token timestamps.
2. **Text accuracy** — even the best whisper model mis-spells names and mis-hears
   words. There is no way to correct the transcript at scale.
3. **UX** — editing tools were consolidated into a right sidebar in v4.4.0, but the
   layout mixes project lifecycle, transcription setup, and editing tools in one
   flat panel list, with no clear "get the text right, then edit" workflow.

These are three sub-projects that ship independently:
**(A) timestamp accuracy**, **(B) left sidebar + workspace modes**,
**(C) LLM transcript polish**.

---

## A. Timestamp accuracy (sync fix)

### Approach

Upgrade the bundled `whisper-cli` to current whisper.cpp and enable DTW word-level
timestamp refinement for the large models, plus a silence-snapping post-process.
(Approach chosen over a WhisperX-style forced-alignment sidecar, which is kept as a
pre-specced fallback — see "Escalation" below.)

### Changes

1. **Upgrade `whisper-cli`** to current whisper.cpp (Core ML + Metal build as
   today). Update the build recipe in `HOW_TO_RUN.md`.
2. **Enable DTW for large models** — `dtw_preset_for_model()` in
   `src-tauri/src/commands/transcribe.rs` gains:
   - `large-v3` → `large.v3`
   - `large-v3-turbo` → `large.v3.turbo`

   Existing model presets unchanged. Existing flags kept (`--split-on-word`,
   `--word-thold 0.01`, `--max-len 0`, `--best-of 5 --beam-size 5`).
3. **Parse DTW timestamps** — `parse_whisper_json` prefers the DTW-refined token
   timestamps (`t_dtw`) when present; falls back to standard offsets otherwise, so
   a stale binary still transcribes.
4. **Graceful degradation** — if `whisper-cli` rejects a `--dtw` preset (stale
   binary), retry once without `--dtw` and log a warning; never fail the
   transcription for this.
5. **Silence-boundary snapping** — new pure module `src/lib/timestampSnap.ts`
   (unit-tested like `lib/edl.ts`). After transcription, run the existing ffmpeg
   `silencedetect` pass (already built for pause detection) and snap word
   boundaries: if a word's start/end falls inside a detected silence, pull it to
   the silence edge. Maximum adjustment **120 ms**; never move a boundary across
   another word. Guarantees cuts land in silence, not mid-word.

### Acceptance criteria (hard targets — Descript / Premiere class)

- Clicking any word seeks within **±50 ms** of the spoken word onset.
- **Zero cumulative drift**: last word of a 30+ minute video is as accurate as the
  first.
- Every export cut boundary lands in silence or at a DTW word boundary — no
  clipped syllables.
- Verified via a scripted manual test in `docs/manual-test.md`: transcribe a long
  clip, spot-check word onsets at start / middle / end, delete words and export,
  confirm clean cuts.

### Escalation (Phase 2, only if criteria not met)

If DTW + snapping misses the targets: add a wav2vec2 forced-alignment pass in the
existing `mlx-sidecar` (the WhisperX technique). Transcript text from whisper,
per-word boundaries recomputed by phoneme alignment. Not built now; recorded here
so the accuracy bar, not the technique, is the commitment.

### Performance budget

Accuracy first (user decision): 2–3× slower transcription is acceptable. DTW adds
roughly 20–40%; well within budget.

---

## B. Left sidebar + workspace modes

### Layout

The v4.4.0 right sidebar (icon rail + inspector panel) moves to the **left**.
Components move from `src/components/editor/right-sidebar/` to
`src/components/editor/sidebar/`; `RightToolRail` → `ToolRail`,
`RightInspectorPanel` → `InspectorPanel`, `RightEditorSidebar` → `EditorSidebar`.
The rail (hidden on the current branch) returns.

```
┌────────────────────────────────────────────────────────────────────────┐
│ [☰ Project ▾]  My Video ●     [ Transcribe | Edit ]      ↶ ↷   [Save]  │
├──┬─────────────┬──────────────────────────────┬────────────────────────┤
│R │ Inspector   │ TranscriptEditor             │ VideoPreview           │
│a │ panel       │                              │ (PreviewWorkspace)     │
│i │ (280–320px, │                              │                        │
│l │ collapsible)│                              │                        │
├──┴─────────────┴──────────────────────────────┴────────────────────────┤
│ BottomTimeline (waveform)                                               │
│ StatusBar                                                                │
└────────────────────────────────────────────────────────────────────────┘
```

### TopBar (project actions move up)

- **Project menu** (top-left dropdown): New Project, Open Project, Open Media /
  Add Clip, Recent, Snapshots, Close Project.
- Project name + dirty indicator beside it.
- **Mode toggle** (centre): segmented `Transcribe | Edit` control.
- **Undo / Redo / Save** top-right; Save is a prominent button.
- The sidebar **Media panel** slims down to media-specific tools (record, add
  clip); project lifecycle actions leave the sidebar. Music tracks live in the
  Edit-mode **Music** panel only.

### Workspace modes

`editorUiStore.workspaceMode: "transcribe" | "edit"`.

- **Transcribe mode** — get the text right. Rail shows: **Media** (record, add
  clip), **Transcribe** (model picker, language, settings, run/re-run, progress),
  **Polish** (Section C). Transcript area is read-only; shows the polish diff
  overlay during review.
- **Edit mode** — cut the video. Rail shows: **Edit tools** (markers,
  pause/filler/silence actions, zoom), **Chapters**, **B-roll**, **Captions**,
  **Music**, **Export**, **Settings**. Transcript fully editable (words map to
  cuts, as today).

Auto-switching: importing media with no transcript lands in Transcribe mode; a
successful transcription nudges (one-click prompt, not forced) to Edit mode.

### Panel registry (extensibility)

Panels become declarative:

```ts
type PanelDef = {
  id: string;
  icon: LucideIcon;
  label: string;
  modes: WorkspaceMode[];
  component: React.FC;
};
```

The rail renders the registry entries for the current mode. Adding a future panel
is one registry entry + one component file. The registry starts with only real
panels (the v4.4.0 placeholder panels stay deleted).

### Non-regression

Every action reachable in v4.4.0 remains reachable. Keyboard shortcuts unchanged.
The single `<video>` element invariant is preserved — layout moves are CSS/JSX
only, `VideoPreview` never remounts.

---

## C. LLM transcript polish

### Goal

Fix spellings and mis-heard words using a user-configured LLM, without ever
touching a timestamp.

### Connector

Generic OpenAI-compatible chat-completions client in Rust (`reqwest`), new
functions in the existing `commands/llm.rs` group. Polish panel settings:

- **Endpoint URL** — default `http://localhost:11434/v1` (Ollama)
- **API key** — optional (blank for local servers)
- **Model name** — free text, with a picker populated from `GET /v1/models` via a
  **Test connection** button
- Suggested models shown as UI hints: `qwen3:14b` / `qwen2.5:14b` (best
  quality/speed on Apple Silicon), `llama3.1:8b` (lighter machines)
- Temperature fixed at 0

Settings persist in app config (not the `.scribe` project). Covers Ollama,
LM Studio, llama.cpp server, and any cloud endpoint the user explicitly enters —
local by default, user's choice beyond that.

### Alignment-preserving protocol (critical invariant)

- Transcript sent in chunks of ~120 indexed words with surrounding context.
- Model must return JSON substitutions only:

  ```json
  { "corrections": [ { "i": 42, "from": "colonel", "to": "kernel" } ] }
  ```

- A Rust validator enforces: 1-to-1 word substitutions only — no insertions,
  deletions, merges, or reordering; `i` in range; `from` matches the current word.
  Any chunk whose response violates the rules or fails to parse is discarded and
  its original words kept.
- Only `Word.text` ever changes. `Word.start` / `Word.end` and the EDL are
  untouched — **polish cannot cause sync issues by construction.**

### Review flow

- Polish runs as a background job (`jobsStore`, chunk-level progress).
- Corrections appear in the Polish panel as a list, and changed words are
  highlighted inline in the transcript (`old → new`).
- User accepts all, rejects all, or toggles individual corrections. Accepting
  applies one undoable `projectStore` action (⌘Z reverts the whole batch).
- Optional setting: auto-run polish after each transcription (default off);
  review is still required before corrections apply.

### Stated limitation (shown in UI copy)

Polish improves *text* accuracy; timestamp accuracy comes from Section A. Words
whisper never emitted cannot be conjured back — no audio token means no timestamp
to attach text to.

---

## Testing

- **Rust:** unit tests for DTW preset mapping, `t_dtw` parsing + fallback, polish
  response validator (valid, insertion, deletion, reorder, out-of-range,
  malformed JSON).
- **TypeScript:** unit tests for `timestampSnap.ts` (inside silence, outside
  tolerance, boundary-crossing rejection), panel registry filtering by mode,
  correction apply/revert store actions.
- **Manual:** scripted sync-accuracy test in `docs/manual-test.md` (the acceptance
  criteria above); polish end-to-end against a local Ollama.

## Docs to update with implementation

`CHANGELOG.md`, `docs/architecture.md` (layout + transcription + new polish flow),
`README.md` (feature table), `docs/yusafcut-spec.md` (sidebar/mode sections),
`HOW_TO_RUN.md` (whisper-cli build).

## Shipping order

A (sync) → B (sidebar/modes) → C (polish). Each lands as its own version bump per
repo workflow rules. A is independent; C's UI lives in B's Transcribe mode, so B
precedes C.
