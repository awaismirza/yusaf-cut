# Screen Recorder + UI Overhaul — Design

Date: 2026-07-07 · Target version: 4.7.0

## Goals

1. A world-class in-app recorder: screen, screen + webcam (picture-in-picture),
   webcam-only, and voice-over — with global shortcuts for **record, re-record,
   pause/resume, and stop**, and automatic append of the finished recording to
   the **end of the current EDL**.
2. An upgraded bottom timeline (ruler, zoom controls, playhead timecode, hover
   scrub feedback).
3. A refreshed, paid-product-grade visual design: new color scheme, refined
   chrome (top bar, tool rail, panels, status bar), consistent typography.

Non-goals (this release): multi-track EDL / movable webcam overlay after
recording, system-audio (loopback) capture, Intel support.

## 1. Recorder

### Capture engine

All capture uses the bundled `ffmpeg` sidecar with the **avfoundation** input
device — no new native code, no new binaries. Encoding uses
`h264_videotoolbox` (HW).

Modes:

| Mode | ffmpeg topology | Output |
|---|---|---|
| `screen` | 1 input: `"<screen>:<mic>"`, cursor+clicks captured | mp4 |
| `screen-camera` | 2 inputs: screen+mic, camera; `overlay` filter composites a PiP bubble (corner + size selectable) | mp4 |
| `camera` | 1 input: `"<camera>:<mic>"` | mp4 |
| `voiceover` | 1 input: `":<mic>"`, aac | m4a |

PiP is composited at record time because the EDL is single-track; a separate
webcam track would be un-editable today. Corner (4 options) and size
(S/M/L) are chosen in the record dialog.

### Devices

`list_recording_devices` runs `ffmpeg -f avfoundation -list_devices true -i ""`
and parses stderr into `{ videoDevices: [{index, name, isScreen}], audioDevices: [{index, name}] }`.
Screens are entries whose name starts with "Capture screen". Parser is a pure
function with unit tests.

### Session lifecycle (Rust: `recorder.rs` + `commands/record.rs`)

State machine: `Idle → Recording ⇄ Paused → Finalizing → Idle`.

- **start_recording(opts)** — spawns the ffmpeg process writing
  `recordings/<session>/seg-000.mp4`. Marks wall-clock start.
- **pause_recording** — sends `q` to ffmpeg, waits for clean exit; accumulated
  duration is preserved.
- **resume_recording** — spawns a new ffmpeg with identical settings writing
  `seg-001.mp4`, etc.
- **stop_recording** — finishes the current segment; if >1 segment, losslessly
  concatenates via the concat demuxer (`-c copy`, identical encoder settings);
  returns the final path + duration.
- **cancel_recording** — kills the process, deletes the session directory.
  Used by *re-record* (cancel + immediate start with same opts) and dialog
  dismissal.
- Every transition emits `record:state`
  `{ state: "recording"|"paused"|"finalizing"|"idle", elapsedSec, mode }`;
  a 1 Hz tick emits elapsed time while recording.

The old `start_native_recording` / `stop_native_recording` commands are
replaced by this system (removed; Toolbar's record dialog is superseded).

### Global shortcuts

`tauri-plugin-global-shortcut` (Rust plugin + JS API). System-wide, so they
work while the user is in the app being recorded:

- **⌥⌘R** — start recording (opens dialog & starts with last-used settings) /
  stop when a session is active. Registered at app start.
- **⌥⌘P** — pause / resume. Registered only during a session.
- **⌥⌘E** — re-record (discard current take, restart instantly). Session-only.

Shortcuts are displayed in the record dialog and HUD.

### Frontend

- `stores/recordingStore.ts` — session state (mirrors `record:state` events),
  device lists, last-used options (persisted to localStorage), and the
  start/pause/resume/stop/rerecord/cancel actions used by both UI and
  shortcuts.
- `components/Recorder/RecordDialog.tsx` — source pickers (screen / camera /
  mic), PiP corner+size, shortcut cheat-sheet, big red Start button with 3-2-1
  countdown.
- `components/Recorder/RecordingHUD.tsx` — compact pill fixed at the top of the
  editor while recording: pulsing red dot, elapsed timecode, pause/resume,
  re-record, stop. Visible in all workspace modes.
- TopBar gets a **Record** button (red dot icon). The `yusafcut:record` event
  (MediaPanel) opens the same dialog.
- On screen-recording start the main window is **minimized** (so the editor
  isn't in the recording) and restored on stop/pause via `getCurrentWindow()`.

### Auto-append flow

On stop: `importMedia(path)` → transcribe with the user's selected model
(reusing the transcription settings already in Toolbar/localStorage) →
`addMediaWithTranscript(media, words)` — which appends a segment at the end of
the EDL — then seek the playhead to the append point and toast. Voice-over
appends as an audio-only clip. If transcription fails, the clip still appends
with empty words so nothing is lost.

## 2. Timeline improvements

Component stays `Waveform.tsx` (rendering already virtualised + zoomable):

- Header: replace text-only help with **zoom controls** (−, fit, +, zoom
  readout) and a live **playhead timecode badge**; keep legend, tighten it.
- Ruler: tick marks get proper major/minor hierarchy; labels move above bars.
- Hover: vertical hover line + timecode tooltip following the cursor.
- Bars: subtle vertical gradient + rounded caps; selection region gets a soft
  glass fill; playhead gets a brighter head and hairline.
- All visual — no changes to EDL math or interaction model (drag-select, I/O
  marks, ⌘-wheel zoom stay as-is).

## 3. Visual redesign

Keep the CSS-variable system and every existing class name; re-skin via
`globals.css` tokens plus targeted chrome rules:

- Palette: deep neutral **graphite** (hue 240, 4–6% saturation) replacing the
  warm 30-hue browns; **indigo-violet accent** `hsl(252 85% 67%)` replacing
  teal; coral destructive; amber filler (kept). Elevated surfaces get a
  1-step lightness ladder (bg 7% → panel 10% → popover 13%).
- Chrome: slightly taller top bar with centered mode switch, Record button,
  cleaner button states; tool rail active state becomes a filled pill; panels
  get consistent 12px section rhythm; status bar quieter.
- Typography: keep system stack; unify sizes (11/12/13) and weights; tabular
  numerals everywhere timecodes appear.
- Hardcoded `hsl(30 …)` chrome colors in globals.css are replaced with
  token-derived values so future theming is one-file.

## 4. Permissions & config

- `Info.plist` already has camera + microphone usage strings; screen capture
  TCC prompt is triggered automatically by avfoundation.
- `capabilities/default.json` adds `global-shortcut:allow-register`,
  `global-shortcut:allow-unregister`, `global-shortcut:allow-is-registered`,
  and `core:window:allow-minimize` / `allow-unminimize` / `allow-set-focus`.
- Cargo adds `tauri-plugin-global-shortcut = "2"`; npm adds
  `@tauri-apps/plugin-global-shortcut`.

## 5. Testing

- Rust unit tests: avfoundation device-list parser; concat list builder;
  ffmpeg arg builder per mode (pure functions in `recorder.rs`).
- Vitest: recordingStore reducer-style helpers (state transitions from
  `record:state` payloads); existing EDL append behaviour already covered.
- `npm run check`, `npm test`, `cargo test` must pass.

## 6. Error handling

- ffmpeg spawn/exit failures surface as destructive toasts with stderr tail.
- Denied screen/camera/mic TCC permission → ffmpeg exits immediately; the
  error toast explains which permission to grant in System Settings.
- A crash mid-session leaves segment files in `recordings/<session>/`; stop
  concatenates whatever segments exist (best-effort salvage).

## 7. Docs & versioning

CHANGELOG entry, architecture.md (recorder data flow + new module),
README feature table, yusafcut-spec.md recorder section. Version bump to
**4.7.0** in package.json, Cargo.toml, tauri.conf.json.
