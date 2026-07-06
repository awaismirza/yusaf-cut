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
│   │    editorUiStore  — workspace mode, active panel,        │   │
│   │                     aspect ratio, zoom, find state       │   │
│   │    recordingStore — recorder session, devices, global    │   │
│   │                     shortcuts, auto-append pipeline      │   │
│   │  + zundo (50-step undo on projectStore)                  │   │
│   └────────────────┬─────────────────────────────────────────┘   │
└────────────────────┼─────────────────────────────────────────────┘
                     │ Tauri `invoke` / events
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ Rust backend (src-tauri/)                                        │
│                                                                  │
│   commands/{media,transcribe,project,export,snapshots,llm,       │
│             jobs,misc,pauses,record}                             │
│   ├── parse_ffprobe_json  (pure, tested)                         │
│   ├── parse_whisper_json  (pure, tested)                         │
│   ├── recorder arg/device parsers (pure, tested)                 │
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

## Recorder

The in-app recorder (v4.7.0) captures the screen, screen + camera
(picture-in-picture), camera, or a microphone-only voice-over — all through the
bundled `ffmpeg` sidecar's **avfoundation** input with `h264_videotoolbox`
hardware encoding. No extra binaries or native capture code.

Data flow:

```
RecorderDialog / ⌥⌘R ──▶ recordingStore.beginCountdown()
                              │ 3-2-1 · minimise window for screen modes
                              ▼
                    start_recording(opts)          (commands/record.rs)
                              │ spawns ffmpeg → recordings/rec-<id>/seg-000.mp4
      pause ⌥⌘P ──▶ pause_recording  — sends `q`, segment is finalised
      resume    ──▶ resume_recording — spawns seg-001, seg-002, …
      re-record ⌥⌘E ─▶ cancel_recording + start_recording (same opts)
      stop ⌥⌘R  ──▶ stop_recording   — concat demuxer joins segments (-c copy)
                              │ RecordingResult { path, durationSec, mode }
                              ▼
              importMedia → transcribe (best installed model)
              → snapWordsToSilences → addMediaWithTranscript
              → segment APPENDED at the end of the EDL
```

Key pieces:

- `src-tauri/src/recorder.rs` — pure, unit-tested: avfoundation device-list
  parser, per-mode ffmpeg argument builder (including the `scale2ref` +
  `overlay` PiP filter), concat manifest builder.
- `src-tauri/src/commands/record.rs` — process lifecycle, `record:state`
  events (1 Hz elapsed ticks) and `record:error`.
- `src/stores/recordingStore.ts` — session state machine
  (`idle → countdown → recording ⇄ paused → finalizing → processing`),
  device defaults, persisted options, global-shortcut registration
  (`tauri-plugin-global-shortcut`), auto-append pipeline.
- `src/components/Recorder/` — `RecorderDialog` (source pickers, PiP
  corner/size, shortcut cheat-sheet) and `RecordingHUD` (floating live pill).

Pause/resume never re-encodes: every segment uses identical encoder settings,
so the final join is a lossless stream copy.

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
- `--dtw <preset>` — DTW cross-attention timestamp refinement, all models
  including `large.v3` / `large.v3.turbo` (dot-form preset names; the parser
  prefers the emitted `t_dtw` values and falls back to standard offsets)

If whisper-cli rejects the DTW preset (stale binary), the transcription is
retried once without `--dtw` rather than failing.

After transcription, word boundaries are snapped to ffmpeg-silencedetect
edges by `src/lib/timestampSnap.ts` (max 120 ms adjustment) so cuts always
land in silence, never mid-word.

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

`EditorLayout` is the root shell component (v4.6.0). It renders:

- **TopBar** (40 px) — Project menu (New/Open project, Open video, Add clip,
  Recent projects, Snapshots, Close), project name, dirty indicator,
  `Transcribe | Edit` mode toggle, Undo, Redo, Save
- **EditorSidebar** (left, fixed) — 52 px `ToolRail` + 320 px `InspectorPanel`
- **TranscriptEditor** (centre, resizable) — shown only when a transcript exists;
  read-only while in Transcribe mode
- **PreviewWorkspace** (right, flex-1) — wraps the single `<video>` instance
- **BottomTimeline** — waveform, shown only when media is loaded
- **StatusBar** — project stats
- **Toolbar** — renders only its modal dialogs; no visible chrome

Panels are declared in `components/editor/sidebar/registry.tsx` and filtered by
`editorUiStore.workspaceMode`: Transcribe mode shows Media and Transcribe;
Edit mode shows Edit Tools, Music, and Export. `EditorSidebar` composes
`ToolRail` (one icon per registered panel) and `InspectorPanel` (renders the
active panel component). Panel and mode state live in `editorUiStore`.
Importing media with no transcript auto-switches to Transcribe mode.

The old two-row toolbar was removed in v4.4.0; the v4.4.0 right sidebar moved
to the left in v4.6.0. All actions are accessible through the sidebar panels,
the TopBar Project menu, or keyboard shortcuts.

## Cross-platform code that isn't

The Tauri shell supports Linux and Windows, but YusafCut explicitly targets
Apple Silicon macOS. The architectural choice rests on whisper.cpp's Core ML +
Metal path and FFmpeg's VideoToolbox. We accept the lock-in for the
performance moat per spec section 1's non-goals.
