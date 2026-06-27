# Architecture

This document explains how the code maps to the spec at the repo root.

## Layered view

```
┌──────────────────────────────────────────────────────────────────┐
│ React + Tauri webview                                            │
│                                                                  │
│   ┌───────────────────────┐   ┌────────────────────────────────┐ │
│   │ TranscriptEditor      │   │ VideoPreview / Waveform        │ │
│   │ (TipTap + Word/Pause) │◀──┤ (HTML5 <video> + WaveSurfer)   │ │
│   └─────────┬─────────────┘   └────────────┬───────────────────┘ │
│             │                              │                     │
│             ▼                              ▼                     │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  Zustand stores                                          │   │
│   │    projectStore    — EDL + project metadata              │   │
│   │    playerStore    — playback position, markers, zoom     │   │
│   │    uiStore        — modal state, loaders, toasts         │   │
│   │    jobsStore      — background job mirror from Rust      │   │
│   │    editorUiStore  — active panel, aspect ratio,          │   │
│   │                     preview zoom, auto-fit, find state   │   │
│   │  + zundo (50-step undo on projectStore)                  │   │
│   └────────────────┬─────────────────────────────────────────┘   │
└────────────────────┼─────────────────────────────────────────────┘
                     │ Tauri `invoke` / events
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ Rust backend (src-tauri/)                                        │
│                                                                  │
│   commands/{media,transcribe,project,export,snapshots,llm,       │
│             jobs,misc,pauses}                                    │
│   ├── parse_ffprobe_json  (pure, tested)                         │
│   ├── parse_whisper_json  (pure, tested)                         │
│   └── filter graph builder (pure, tested)                        │
│                                                                  │
│   sidecar processes:                                             │
│     - ffprobe                                                    │
│     - ffmpeg (with VideoToolbox hw encode/decode)                │
│     - whisper-cli (Core ML + Metal, whisper.cpp)                 │
│     - mlx-sidecar (optional on-device LLM, `mlx-sidecar` feat)  │
└──────────────────────────────────────────────────────────────────┘
```

## The EDL contract

Everything important happens through `Project`:

```ts
type Project = {
  version: 1;
  id: string; name: string;
  createdAt: string; updatedAt: string;
  media: Record<MediaId, SourceMedia>;
  segments: Segment[];              // ORDER MATTERS — this IS the timeline
  settings: { exportPreset; paddingMs };
  chapters?: Chapter[];             // output-timeline chapter markers
  musicTracks?: MusicTrack[];       // audio bed tracks
}
```

**Invariants** (enforced by tests):

1. `Word.start` / `Word.end` are immutable source timecodes.
2. Source timecodes (`sourceIn`, `sourceOut`) refer to the original media file.
3. Deleting a word range splits the affected segment(s) and drops the middle.
4. `paddingMs` is applied at the *boundary* of cuts only — never to the start of
   the first surviving run or the end of the last surviving run.

`tests/edl.test.ts` is the canonical reference. Read it before changing any
EDL operation.

## UI loading pattern

Every operation that blocks the UI **must** show a progress indicator. The
`uiStore` tracks five loader states:

| Field | Shown when |
|---|---|
| `mediaLoading` | ffprobe probe in progress (import or project open) |
| `transcribeProgress` | whisper-cli transcription running |
| `exportingProgress` | ffmpeg export in progress |
| `modelDownloadProgress` | model .bin/.zip download in progress |
| `editOperationLabel` | any heavy synchronous edit (Trim Silences, etc.) |

For synchronous heavy operations (anything that runs on the JS main thread and
blocks for > 100 ms), use the double-`requestAnimationFrame` deferred pattern
so React renders the dialog before the work starts:

```ts
setEditOperationLabel("Doing X…");
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    try {
      doHeavyWork();
    } finally {
      setEditOperationLabel(null);
    }
  });
});
```

## Transcription engine

YusafCut uses **whisper.cpp** exclusively via the `whisper-cli` sidecar with Core
ML + Metal acceleration. Key CLI flags for timestamp accuracy:

- `--split-on-word` — per-token word boundaries
- `--word-thold 0.01` — keep all tokens even with low probability
- `--max-len 0` — unbounded segment length; prevents timestamp compression drift
- `--best-of 5 --beam-size 5` — beam search for transcript quality

WhisperKit (ANE) was removed in v3.2.0 because quantized models produced
inaccurate word timestamps causing video/text drift. To restore it, run:
`git show 4726d25:src-tauri/src/commands/transcribe.rs`

## Why a single `<video>` element

We chose one `<video>` element driving the source media, with the player
jumping over deleted ranges in `timeupdate`. Browsers seek MP4s in tens of
milliseconds, which satisfies the ~50 ms accuracy target in the spec.

Creating a second `<video>` node when the layout switches from the landing
screen to the editing view would unmount and remount the element, dropping
the loaded source and decoded buffers. The `EditorLayout` component always renders the
same wrapper around the single `VideoPreview` instance and only toggles
CSS classes to move it between the landing and editing layouts.

## UI layout

`EditorLayout` is the root shell component (v4.4.0). It renders:

- **TopBar** (40 px) — project name, dirty indicator, Save, Undo, Redo
- **TranscriptEditor** (left, resizable) — shown only when a transcript exists
- **PreviewWorkspace** (centre, flex-1) — wraps the single `<video>` instance
- **RightEditorSidebar** (right, fixed) — 52 px icon rail + 320 px inspector panel
- **BottomTimeline** — waveform, shown only when media is loaded
- **StatusBar** — project stats
- **Toolbar** — renders only its modal dialogs; no visible chrome

`RightEditorSidebar` composes `RightToolRail` (12 icon buttons) and `RightInspectorPanel`
(renders the active panel component). Panel state lives in `editorUiStore`.

The old two-row toolbar was removed in v4.4.0. All actions are now accessible
through the right-sidebar panels or via keyboard shortcuts.

## Cross-platform code that isn't

The Tauri shell supports Linux and Windows, but YusafCut explicitly targets
Apple Silicon macOS. The architectural choice rests on whisper.cpp's Core ML +
Metal path and FFmpeg's VideoToolbox. We accept the lock-in for the
performance moat per spec section 1's non-goals.
