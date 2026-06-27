# YusafCut — Right-Sidebar UI Refactor Design

**Date:** 2026-06-28  
**Scope:** UI refactor only. No EDL, transcription, export, or project-model changes.  
**Reference:** ScreenKite-style right sidebar; existing YusafCut editor as baseline.

---

## 1. Goal

Move layout/preset/import/export/crop/annotate/mask/transcribe controls from the top toolbar into a right-side vertical icon rail + contextual inspector panel. Simplify the top bar to a minimal project title bar. Keep the TranscriptEditor in its current left-panel position. All existing functionality is preserved — only its location in the UI changes.

---

## 2. Layout

```
┌───────────────────────────────────────────────────────────────────┐
│  TopBar (40px): project name · dirty state · Save · Undo · Redo   │
├────────────────────────┬──────────────────┬───────┬───────────────┤
│                        │                  │       │               │
│   TranscriptEditor     │  PreviewWorkspace│ Rail  │   Inspector   │
│   (left, resizable)    │  (flex-1)        │ 52px  │   320px       │
│                        │                  │       │               │
├────────────────────────┴──────────────────┴───────┴───────────────┤
│  BottomTimeline (170px): Waveform + transport controls             │
├───────────────────────────────────────────────────────────────────┤
│  StatusBar (26px)                                                  │
└───────────────────────────────────────────────────────────────────┘
```

The existing drag-to-resize divider between TranscriptEditor and VideoPreview is preserved. The right sidebar is a fixed-width addition on the far right.

---

## 3. Component Structure

```
src/components/editor/
  EditorLayout.tsx           ← root shell replacing inline App.tsx layout
  TopBar.tsx                 ← project name, dirty state, Save, Undo, Redo
  PreviewWorkspace.tsx       ← wraps VideoPreview; ResizeObserver auto-fit
  BottomTimeline.tsx         ← wraps Waveform; labels transport controls area
  right-sidebar/
    RightEditorSidebar.tsx   ← composes RightToolRail + RightInspectorPanel
    RightToolRail.tsx        ← 52px icon rail, 12 icon buttons
    RightInspectorPanel.tsx  ← 320px contextual panel; renders active panel
    panels/
      LayoutPanel.tsx
      BackgroundPanel.tsx
      ScreenPanel.tsx
      CropPanel.tsx
      AnnotatePanel.tsx
      MaskPanel.tsx
      TranscriptPanel.tsx    ← Transcribe button + Toolbox ops
      CaptionsPanel.tsx
      AiPanel.tsx
      MediaPanel.tsx         ← Open/Add Clip/Record/Music
      ExportPanel.tsx        ← Export + caption export
      SettingsPanel.tsx

src/stores/
  editorUiStore.ts           ← NEW: activeRightPanel, aspectRatio,
                                    previewZoom, autoZoomEnabled

src/components/Toolbar/
  Toolbar.tsx                ← keeps all dialog JSX + async handlers;
                                render returns only dialogs (no toolbar chrome)
```

`App.tsx` becomes a thin shell: hooks + drag-resize logic + `<EditorLayout />`.

---

## 4. State Management

### New store: `editorUiStore.ts`

```ts
type RightEditorPanel =
  | "layout" | "background" | "screen" | "crop" | "annotate"
  | "mask" | "transcript" | "captions" | "ai" | "media"
  | "export" | "settings";

interface EditorUiState {
  activeRightPanel: RightEditorPanel;
  inspectorOpen: boolean;           // false when rail icon clicked again to collapse
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3";
  previewZoom: number;              // 0.25–2.0
  autoZoomEnabled: boolean;

  setActiveRightPanel: (panel: RightEditorPanel) => void;
  toggleInspector: () => void;
  setAspectRatio: (ar: EditorUiState["aspectRatio"]) => void;
  setPreviewZoom: (zoom: number) => void;
  setAutoZoomEnabled: (enabled: boolean) => void;
}
```

All other stores (`projectStore`, `playerStore`, `uiStore`, `jobsStore`) are untouched.

### Inspector toggle behaviour

Clicking an already-active rail icon toggles `inspectorOpen`. Clicking a different icon sets `activeRightPanel` and opens the inspector if it was closed.

---

## 5. Controls Migration

| Control | Currently | Moves to |
|---|---|---|
| Project name / dirty state | Toolbar top row | TopBar |
| Save | Toolbar bottom row | TopBar |
| Undo / Redo | (keyboard only) | TopBar (buttons + keyboard) |
| Export .mp4 button | Toolbar top row | ExportPanel |
| Captions export button | Toolbar top row | CaptionsPanel |
| Open (import media) | Toolbar bottom row | MediaPanel |
| File ▾ menu (New, Open Project, Add Clip, Snapshots, Close) | Toolbar bottom row | MediaPanel + SettingsPanel |
| Transcribe / Re-Transcribe | Toolbar bottom row | TranscriptPanel |
| Capture ▾ (Record, Music tracks) | Toolbar bottom row | MediaPanel |
| Toolbox: Select, Find | Toolbar bottom row | TranscriptPanel |
| Toolbox: Markers dropdown | Toolbar bottom row | TranscriptPanel |
| Toolbox: Edit dropdown (silences/fillers/pauses/chapters) | Toolbar bottom row | TranscriptPanel |
| Toolbox: Zoom in/out/reset | Toolbar bottom row | TranscriptPanel |
| Duration readout | Toolbar top row | ExportPanel (or StatusBar) |
| Layout, Presets, Aspect ratio | (new) | LayoutPanel |
| Background controls | (new) | BackgroundPanel |
| Crop, Annotate, Mask | (new) | CropPanel / AnnotatePanel / MaskPanel |
| AI quick actions | (new) | AiPanel |
| Captions style settings | (new) | CaptionsPanel |
| Screen transform controls | (new) | ScreenPanel |
| Settings | (new) | SettingsPanel |

All dialogs (model picker, export settings, record, loading spinners) stay in `Toolbar.tsx` as render-only dialogs. They are triggered via `window.dispatchEvent` from the panels that own the CTA buttons, or via store state.

---

## 6. RightToolRail

- Width: 52px, full height of MainEditorArea
- Background: `hsl(30 5% 9%)` (same as current toolbar)
- Left border: `1px solid hsl(var(--border))`
- 12 icon buttons, stacked vertically, top-aligned
- Each button: 44px × 44px, rounded-md, icon centered
- Active state: blue/primary fill + left accent bar (`border-l-2 border-primary`)
- Hover state: `bg-accent`
- Tooltip: `title` attribute (native macOS tooltip is sufficient)
- Keyboard accessible: focusable, `role="button"`, Space/Enter to activate

Icon mapping (all from `lucide-react`):
```
layout     → LayoutTemplate
background → Palette
screen     → Monitor
crop       → Crop
annotate   → PenTool
mask       → Scan
transcript → FileText
captions   → Captions
ai         → Sparkles
media      → FolderOpen
export     → Upload
settings   → Settings
```

---

## 7. RightInspectorPanel

- Width: 320px, collapsible (0px when `inspectorOpen = false`)
- Background: `hsl(30 4% 14%)` (card token)
- Left border: `1px solid hsl(var(--border))`
- Internal layout: `overflow-y: auto`, thin custom scrollbar
- Section labels: uppercase, 10px, `muted-foreground`, `letter-spacing: 0.06em`
- Control spacing: 12–16px padding per section
- Uses existing shadcn/ui: `Button`, `Slider` (Radix already installed), `Switch` (needs install or native checkbox), `Separator`

Inspector width is fixed (not user-resizable in this pass). The inspector can be collapsed by clicking the active rail icon again.

---

## 8. Panel Content (summary)

### TranscriptPanel
- Transcribe / Re-Transcribe button (calls `window.dispatchEvent(new CustomEvent("yusafcut:transcribe"))` which Toolbar listens to)
- Model label (read from `projectStore` or display "large-v3-turbo" as default)
- Separator
- Inline Toolbox: Select, Find, Markers, Edit ops, Zoom (renders `<Toolbox />` component directly)
- Low-confidence word count (placeholder)
- Restore deleted words (placeholder)

### MediaPanel
- Open video button → calls `handleOpen()` (imported or via event)
- Add clip button → calls `handleAddClip()`
- Record button → calls `window.dispatchEvent(new CustomEvent("yusafcut:record"))`
- Music tracks button → calls `window.dispatchEvent(new CustomEvent("yusafcut:music"))`
- Snapshots button → calls `window.dispatchEvent(new CustomEvent("yusafcut:snapshots"))`
- New project / Open project / Close project (from File menu)
- Recent media placeholder section

### ExportPanel
- Export .mp4 button (prominent, full-width, primary) → `window.dispatchEvent(new CustomEvent("yusafcut:export"))`
- Captions export button (secondary) → `window.dispatchEvent(new CustomEvent("yusafcut:export-captions"))`
- Format selector placeholder (MP4 H.264, HEVC, Audio only)
- Quality selector placeholder (Draft, Standard, High)
- Duration readout

### LayoutPanel
- Aspect ratio segmented control (16:9 / 9:16 / 1:1 / 4:3) → `editorUiStore`
- Preset buttons (YouTube 1080p, Shorts/TikTok, Square, Podcast)
- Preview fit segmented control (Fit / Fill / 100%)
- Auto zoom toggle + sensitivity/smoothness sliders (placeholder)

### BackgroundPanel, ScreenPanel, CropPanel, AnnotatePanel, MaskPanel, CaptionsPanel, AiPanel, SettingsPanel
All UI-state-only placeholder panels with styled controls. No backend changes.

---

## 9. TopBar

- Height: 40px
- Background: `hsl(30 5% 9%)`
- Bottom border: `1px solid hsl(var(--border))`
- Left: project filename (truncated), dirty indicator (·)
- Center: empty or app wordmark
- Right: Undo button, Redo button, Save button
- Undo/Redo: `useProjectStore.getState().undo()` / `.redo()` (zundo store; keyboard shortcuts still work)
- Save: dispatches `"yusafcut:save"` (Toolbar listens) or calls save directly

---

## 10. PreviewWorkspace & Auto-Fit

`PreviewWorkspace` wraps the existing `VideoPreview` component with a `ResizeObserver`. When the container size changes and `autoZoomEnabled` is true, it computes:

```ts
const fitZoom = Math.min(
  containerWidth / canvasWidth,
  containerHeight / canvasHeight
);
const clamped = Math.max(0.25, Math.min(2.0, fitZoom));
editorUiStore.setPreviewZoom(clamped);
```

`canvasWidth/Height` is derived from `editorUiStore.aspectRatio` (e.g. 16:9 → 1920×1080 base). Manual zoom changes disable auto-zoom. The "Fit" button in the LayoutPanel re-enables auto-zoom and recalculates.

In this pass, `previewZoom` is stored in `editorUiStore` but does not affect the actual video scaling (VideoPreview already fills its container via `max-h-full max-w-full object-contain`). The zoom value is wired to a display readout only. Real zoom rendering is a future task.

---

## 11. BottomTimeline

`BottomTimeline.tsx` is a thin wrapper around the existing `Waveform` component. It adds:
- A section label "Timeline" (leftmost, uppercase, 11px)
- Comments clarifying this area will become the full transcript timeline

No changes to Waveform internals.

---

## 12. Toolbar.tsx (dialog-only mode)

`Toolbar.tsx` keeps:
- All `useState` for dialog open states, model list, export settings, recording state
- All async handlers: `handleOpen`, `handleAddClip`, `handleTranscribe`, `runExport`, `handleExportCaptions`, `startRecording`, `stopRecording`, `handleDownloadModel`, `handleDeleteModel`, `handleSave`
- All `useEffect` wired to `yusafcut:save`, `yusafcut:export`, and new custom events: `yusafcut:transcribe`, `yusafcut:record`, `yusafcut:music`, `yusafcut:snapshots`, `yusafcut:export-captions`
- All dialog JSX: model picker, export settings, record, loading overlays
- Returns a fragment of just those dialogs — no toolbar chrome

The `onFindClick` prop is removed (Find moves to TranscriptPanel which renders Toolbox directly).

---

## 13. Styling Tokens

All new components use existing CSS custom properties:
- `--background: 30 4% 12%` — app background
- `--secondary: 30 4% 16%` — panel backgrounds  
- `--card: 30 4% 14%` — inspector background
- `--border: 30 4% 24%` — dividers
- `--primary: 188 60% 55%` — teal accent (active states)
- `--muted-foreground: 30 4% 58%` — section labels, dim text

No new CSS variables needed.

---

## 14. Acceptance Criteria

- App launches; existing functionality (open, save, transcribe, export, undo/redo) works
- Top bar is single row, ~40px, shows project name + Save + Undo + Redo
- Right rail shows 12 icons; clicking each opens the correct inspector panel
- Clicking the active icon collapses the inspector
- TranscriptPanel shows Transcribe button + all Toolbox controls
- MediaPanel shows Open / Add Clip / Record / Music buttons
- ExportPanel shows Export .mp4 button that triggers the existing export dialog
- Background, Layout, Screen, Crop, Annotate, Mask, Captions, AI, Settings panels render styled placeholder controls
- Inspector panel is 320px, scrollable, dark styled
- `editorUiStore` holds `activeRightPanel`, `inspectorOpen`, `aspectRatio`, `previewZoom`, `autoZoomEnabled`
- PreviewWorkspace renders VideoPreview with ResizeObserver wired to zoom store
- BottomTimeline wraps Waveform unchanged
- TypeScript passes (`npm run typecheck`)
- ESLint passes (`npm run lint`)

---

## 15. Out of Scope

- Real canvas scaling / aspect ratio rendering
- Real crop / annotate / mask implementation
- Real captions overlay rendering
- Real AI integration
- Inspector panel user-resizing
- Switching to a different color scheme or accent color
- Any Rust / backend changes
