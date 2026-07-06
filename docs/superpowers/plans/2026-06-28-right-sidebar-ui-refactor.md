# Right-Sidebar UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-row top toolbar with a minimal TopBar + right-side icon rail + contextual inspector panel, moving all controls (import, export, transcribe, edit tools, layout, etc.) into 12 inspector panels.

**Architecture:** Keep the existing TranscriptEditor in its current left-panel position; add `RightEditorSidebar` as a new flex item after the video `<aside>`; a new `EditorLayout` component owns the drag-resize logic currently in `App.tsx`; `Toolbar.tsx` is gutted to render only its dialogs (no chrome) and gains event listeners for new custom events dispatched by the panels.

**Tech Stack:** React 18, TypeScript 5, Zustand 5 + zundo 2, Tailwind CSS 3, shadcn/ui, lucide-react, Tauri 2.

## Global Constraints

- Apple Silicon macOS only — no platform-specific code changes needed for this task
- No EDL, transcription, export, or Rust changes
- Existing `projectStore`, `playerStore`, `uiStore`, `jobsStore` are untouched
- `VideoPreview` must remain a single mounted instance — never conditionally render or swap it
- Prettier: double quotes, semicolons, trailing commas, 100-char line width, 2-space indent
- ESLint max-warnings=0; no unused vars (underscore prefix excepted)
- `npm run typecheck` and `npm run lint` must pass before the final commit
- Commit messages must not mention Claude, AI, or co-authorship
- Version bump target: 4.3.0 → 4.4.0 (minor — new feature)

---

## File Map

**Create:**
- `src/stores/editorUiStore.ts`
- `src/components/editor/EditorLayout.tsx`
- `src/components/editor/TopBar.tsx`
- `src/components/editor/PreviewWorkspace.tsx`
- `src/components/editor/BottomTimeline.tsx`
- `src/components/editor/right-sidebar/RightEditorSidebar.tsx`
- `src/components/editor/right-sidebar/RightToolRail.tsx`
- `src/components/editor/right-sidebar/RightInspectorPanel.tsx`
- `src/components/editor/right-sidebar/panels/LayoutPanel.tsx`
- `src/components/editor/right-sidebar/panels/BackgroundPanel.tsx`
- `src/components/editor/right-sidebar/panels/ScreenPanel.tsx`
- `src/components/editor/right-sidebar/panels/CropPanel.tsx`
- `src/components/editor/right-sidebar/panels/AnnotatePanel.tsx`
- `src/components/editor/right-sidebar/panels/MaskPanel.tsx`
- `src/components/editor/right-sidebar/panels/TranscriptPanel.tsx`
- `src/components/editor/right-sidebar/panels/CaptionsPanel.tsx`
- `src/components/editor/right-sidebar/panels/AiPanel.tsx`
- `src/components/editor/right-sidebar/panels/MediaPanel.tsx`
- `src/components/editor/right-sidebar/panels/ExportPanel.tsx`
- `src/components/editor/right-sidebar/panels/SettingsPanel.tsx`
- `tests/editorUiStore.test.ts`

**Modify:**
- `src/App.tsx` — remove layout JSX + drag-resize state; keep hooks + drag-drop; render `<EditorLayout />`
- `src/components/Toolbar/Toolbar.tsx` — remove toolbar chrome from render; remove `onFindClick` prop; add event listeners for new custom events
- `src/styles/globals.css` — add new CSS classes for topbar, rail, inspector

**Version bump (final task):**
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `CHANGELOG.md`

---

### Task 1: Create feature branch and editorUiStore

**Files:**
- Create: `src/stores/editorUiStore.ts`
- Create: `tests/editorUiStore.test.ts`

**Interfaces:**
- Produces:
  - `RightEditorPanel` (exported union type)
  - `useEditorUiStore` (Zustand store hook)
  - `useEditorUiStore.getState()` with `setActiveRightPanel`, `setFindOpen`, `setPreviewZoom`, `setAutoZoomEnabled`, `setAspectRatio`

---

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull origin main
git checkout -b feature/right-sidebar-ui
```

- [ ] **Step 2: Write the failing test**

Create `tests/editorUiStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorUiStore } from "@/stores/editorUiStore";

describe("editorUiStore", () => {
  beforeEach(() => {
    useEditorUiStore.setState({
      activeRightPanel: "transcript",
      inspectorOpen: true,
      findOpen: false,
      aspectRatio: "16:9",
      previewZoom: 1,
      autoZoomEnabled: true,
    });
  });

  it("starts with transcript panel active and inspector open", () => {
    const { activeRightPanel, inspectorOpen } = useEditorUiStore.getState();
    expect(activeRightPanel).toBe("transcript");
    expect(inspectorOpen).toBe(true);
  });

  it("setActiveRightPanel switches to a new panel and opens inspector", () => {
    useEditorUiStore.getState().setActiveRightPanel("export");
    const { activeRightPanel, inspectorOpen } = useEditorUiStore.getState();
    expect(activeRightPanel).toBe("export");
    expect(inspectorOpen).toBe(true);
  });

  it("setActiveRightPanel on the already-active panel toggles inspector closed", () => {
    useEditorUiStore.getState().setActiveRightPanel("transcript"); // already active
    expect(useEditorUiStore.getState().inspectorOpen).toBe(false);
  });

  it("setActiveRightPanel on active-but-closed panel reopens inspector", () => {
    useEditorUiStore.setState({ inspectorOpen: false });
    useEditorUiStore.getState().setActiveRightPanel("transcript"); // active + closed
    expect(useEditorUiStore.getState().inspectorOpen).toBe(true);
  });

  it("setFindOpen sets findOpen to true", () => {
    useEditorUiStore.getState().setFindOpen(true);
    expect(useEditorUiStore.getState().findOpen).toBe(true);
  });

  it("setFindOpen sets findOpen to false", () => {
    useEditorUiStore.setState({ findOpen: true });
    useEditorUiStore.getState().setFindOpen(false);
    expect(useEditorUiStore.getState().findOpen).toBe(false);
  });

  it("setPreviewZoom updates previewZoom", () => {
    useEditorUiStore.getState().setPreviewZoom(0.75);
    expect(useEditorUiStore.getState().previewZoom).toBe(0.75);
  });

  it("setAspectRatio updates aspectRatio", () => {
    useEditorUiStore.getState().setAspectRatio("9:16");
    expect(useEditorUiStore.getState().aspectRatio).toBe("9:16");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/editorUiStore.test.ts
```

Expected: FAIL with "Cannot find module '@/stores/editorUiStore'"

- [ ] **Step 4: Create the store**

Create `src/stores/editorUiStore.ts`:

```ts
import { create } from "zustand";

export type RightEditorPanel =
  | "layout"
  | "background"
  | "screen"
  | "crop"
  | "annotate"
  | "mask"
  | "transcript"
  | "captions"
  | "ai"
  | "media"
  | "export"
  | "settings";

interface EditorUiState {
  activeRightPanel: RightEditorPanel;
  inspectorOpen: boolean;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3";
  previewZoom: number;
  autoZoomEnabled: boolean;
  findOpen: boolean;

  setActiveRightPanel: (panel: RightEditorPanel) => void;
  setAspectRatio: (ar: "16:9" | "9:16" | "1:1" | "4:3") => void;
  setPreviewZoom: (zoom: number) => void;
  setAutoZoomEnabled: (enabled: boolean) => void;
  setFindOpen: (open: boolean) => void;
}

export const useEditorUiStore = create<EditorUiState>((set, get) => ({
  activeRightPanel: "transcript",
  inspectorOpen: true,
  aspectRatio: "16:9",
  previewZoom: 1,
  autoZoomEnabled: true,
  findOpen: false,

  setActiveRightPanel: (panel) => {
    const { activeRightPanel, inspectorOpen } = get();
    if (panel === activeRightPanel) {
      set({ inspectorOpen: !inspectorOpen });
    } else {
      set({ activeRightPanel: panel, inspectorOpen: true });
    }
  },
  setAspectRatio: (ar) => set({ aspectRatio: ar }),
  setPreviewZoom: (zoom) => set({ previewZoom: zoom }),
  setAutoZoomEnabled: (enabled) => set({ autoZoomEnabled: enabled }),
  setFindOpen: (open) => set({ findOpen: open }),
}));
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/editorUiStore.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/stores/editorUiStore.ts tests/editorUiStore.test.ts
git commit -m "feat: add editorUiStore for right-sidebar panel and zoom state"
```

---

### Task 2: Add CSS classes to globals.css

**Files:**
- Modify: `src/styles/globals.css`

**Interfaces:**
- Produces: CSS classes consumed by all new editor components

---

- [ ] **Step 1: Append new CSS to the end of `src/styles/globals.css`**

```css
/* ════════════════════════════════════════════════════════════════════════
   TOP BAR — replaces the two-row toolbar chrome
   ════════════════════════════════════════════════════════════════════════ */
.editor-topbar {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: hsl(30 5% 9%);
  border-bottom: 1px solid hsl(var(--border));
  flex-shrink: 0;
  z-index: 10;
  gap: 12px;
}
.editor-topbar-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font: 600 13px/1 ui-sans-serif, system-ui, sans-serif;
  color: hsl(var(--foreground) / 0.9);
  min-width: 0;
}
.editor-topbar-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(44vw, 520px);
}
.editor-topbar-dirty {
  color: hsl(var(--primary));
  font-size: 18px;
  line-height: 0;
  flex-shrink: 0;
}
.editor-topbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* ════════════════════════════════════════════════════════════════════════
   RIGHT TOOL RAIL — vertical icon strip
   ════════════════════════════════════════════════════════════════════════ */
.right-editor-sidebar {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  height: 100%;
}
.right-tool-rail {
  width: 52px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  background: hsl(30 5% 9%);
  border-left: 1px solid hsl(var(--border));
  overflow-y: auto;
  scrollbar-width: none;
}
.right-tool-rail::-webkit-scrollbar {
  display: none;
}
.right-tool-rail-btn {
  position: relative;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition:
    background 80ms ease,
    color 80ms ease;
  flex-shrink: 0;
}
.right-tool-rail-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.right-tool-rail-btn:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}
.right-tool-rail-btn.is-active {
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
}
.right-tool-rail-btn.is-active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 2px;
  background: hsl(var(--primary));
  border-radius: 0 2px 2px 0;
}

/* ════════════════════════════════════════════════════════════════════════
   RIGHT INSPECTOR PANEL
   ════════════════════════════════════════════════════════════════════════ */
.right-inspector-panel {
  overflow: hidden;
  transition: width 150ms ease;
  display: flex;
  flex-direction: column;
  background: hsl(30 4% 14%);
  border-left: 1px solid hsl(var(--border));
  flex-shrink: 0;
}
.inspector-panel-header {
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid hsl(var(--border));
  flex-shrink: 0;
}
.inspector-panel-title {
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: hsl(var(--muted-foreground));
}
.inspector-panel-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--border)) transparent;
}
.inspector-panel-scroll::-webkit-scrollbar {
  width: 4px;
}
.inspector-panel-scroll::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 2px;
}
.inspector-panel-content {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 24px;
}
.inspector-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
}
.inspector-section-label {
  font: 600 10px/1 ui-sans-serif, system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: hsl(var(--muted-foreground));
  margin: 0;
}
.inspector-divider {
  height: 1px;
  background: hsl(var(--border) / 0.7);
  flex-shrink: 0;
}
.inspector-hint {
  font: 400 11px/1.4 ui-sans-serif, system-ui, sans-serif;
  color: hsl(var(--muted-foreground));
  margin: 0;
}
.inspector-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.inspector-row-label {
  font: 500 12px/1 ui-sans-serif, system-ui, sans-serif;
  color: hsl(var(--muted-foreground));
}
.inspector-row-value {
  font: 500 12px/1 ui-monospace, "Cascadia Code", monospace;
  color: hsl(var(--foreground) / 0.85);
  font-variant-numeric: tabular-nums;
}
.inspector-segmented {
  display: flex;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  overflow: hidden;
  background: hsl(var(--secondary));
}
.inspector-segmented-btn {
  flex: 1;
  height: 28px;
  border: 0;
  background: transparent;
  color: hsl(var(--muted-foreground));
  font: 500 11px/1 ui-sans-serif, system-ui, sans-serif;
  cursor: pointer;
  transition:
    background 80ms ease,
    color 80ms ease;
  border-right: 1px solid hsl(var(--border));
}
.inspector-segmented-btn:last-child {
  border-right: 0;
}
.inspector-segmented-btn:hover:not(:disabled) {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}
.inspector-segmented-btn.is-active {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}
.inspector-segmented-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.inspector-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.inspector-slider-label {
  font: 500 11px/1 ui-sans-serif, system-ui, sans-serif;
  color: hsl(var(--muted-foreground));
  min-width: 60px;
}
.inspector-slider-value {
  font: 500 11px/1 ui-monospace, monospace;
  color: hsl(var(--foreground) / 0.7);
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ════════════════════════════════════════════════════════════════════════
   PREVIEW WORKSPACE
   ════════════════════════════════════════════════════════════════════════ */
.preview-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: #000;
  overflow: hidden;
}

/* ════════════════════════════════════════════════════════════════════════
   BOTTOM TIMELINE
   ════════════════════════════════════════════════════════════════════════ */
.bottom-timeline {
  height: 170px;
  flex-shrink: 0;
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/globals.css
git commit -m "style: add CSS classes for topbar, right rail, and inspector panel"
```

---

### Task 3: TopBar component

**Files:**
- Create: `src/components/editor/TopBar.tsx`

**Interfaces:**
- Consumes: `useProjectStore` (project.name, dirty, filePath), `useTemporalProjectStore` (pastStates.length, futureStates.length), `useProjectStore.temporal.getState()` (undo, redo)
- Produces: `TopBar` (no props)

---

- [ ] **Step 1: Create the directory and component**

```bash
mkdir -p src/components/editor
```

Create `src/components/editor/TopBar.tsx`:

```tsx
import { useCallback } from "react";
import { Undo2, Redo2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore, useTemporalProjectStore } from "@/stores/projectStore";

export function TopBar() {
  const filePath = useProjectStore((s) => s.filePath);
  const dirty = useProjectStore((s) => s.dirty);
  const project = useProjectStore((s) => s.project);
  const canUndo = useTemporalProjectStore((s) => s.pastStates.length > 0);
  const canRedo = useTemporalProjectStore((s) => s.futureStates.length > 0);

  const displayName = filePath?.split(/[\\/]/).pop() ?? `${project.name}.scribe`;

  const handleSave = useCallback(() => {
    window.dispatchEvent(new CustomEvent("yusafcut:save"));
  }, []);

  const handleUndo = useCallback(() => {
    useProjectStore.temporal.getState().undo();
  }, []);

  const handleRedo = useCallback(() => {
    useProjectStore.temporal.getState().redo();
  }, []);

  return (
    <div className="editor-topbar">
      <div className="editor-topbar-title">
        <span className="editor-topbar-name">{displayName}</span>
        {dirty && <span className="editor-topbar-dirty">·</span>}
      </div>
      <div className="editor-topbar-actions">
        <Button
          size="sm"
          variant="ghost"
          className="tool-button"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="tool-button"
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`tool-button${dirty ? " tool-button-primary" : ""}`}
          onClick={handleSave}
          title="Save (⌘S)"
        >
          <Save className="h-4 w-4" />
          {dirty ? "Save *" : "Save"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error|TopBar"
```

Expected: No errors mentioning TopBar.tsx.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/TopBar.tsx
git commit -m "feat: add TopBar with project name, Save, Undo, Redo"
```

---

### Task 4: RightToolRail component

**Files:**
- Create: `src/components/editor/right-sidebar/RightToolRail.tsx`

**Interfaces:**
- Consumes: `useEditorUiStore` (activeRightPanel, setActiveRightPanel)
- Produces: `RightToolRail` (no props)

---

- [ ] **Step 1: Create the directory and component**

```bash
mkdir -p src/components/editor/right-sidebar
```

Create `src/components/editor/right-sidebar/RightToolRail.tsx`:

```tsx
import {
  Captions,
  Crop,
  FileText,
  FolderOpen,
  LayoutTemplate,
  Monitor,
  Palette,
  PenTool,
  Scan,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEditorUiStore, type RightEditorPanel } from "@/stores/editorUiStore";

type LucideIcon = React.FC<{ className?: string }>;

const RAIL_ITEMS: { panel: RightEditorPanel; icon: LucideIcon; label: string }[] = [
  { panel: "layout", icon: LayoutTemplate, label: "Layout" },
  { panel: "background", icon: Palette, label: "Background" },
  { panel: "screen", icon: Monitor, label: "Screen" },
  { panel: "crop", icon: Crop, label: "Crop" },
  { panel: "annotate", icon: PenTool, label: "Annotate" },
  { panel: "mask", icon: Scan, label: "Mask" },
  { panel: "transcript", icon: FileText, label: "Transcript" },
  { panel: "captions", icon: Captions, label: "Captions" },
  { panel: "ai", icon: Sparkles, label: "AI" },
  { panel: "media", icon: FolderOpen, label: "Media" },
  { panel: "export", icon: Upload, label: "Export" },
  { panel: "settings", icon: Settings, label: "Settings" },
];

export function RightToolRail() {
  const activeRightPanel = useEditorUiStore((s) => s.activeRightPanel);
  const setActiveRightPanel = useEditorUiStore((s) => s.setActiveRightPanel);

  return (
    <div className="right-tool-rail" role="toolbar" aria-label="Editor tools">
      {RAIL_ITEMS.map(({ panel, icon: Icon, label }) => {
        const isActive = activeRightPanel === panel;
        return (
          <button
            key={panel}
            type="button"
            className={`right-tool-rail-btn${isActive ? " is-active" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => setActiveRightPanel(panel)}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck 2>&1 | grep -E "error|RightToolRail"
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/right-sidebar/RightToolRail.tsx
git commit -m "feat: add RightToolRail with 12 panel icon buttons"
```

---

### Task 5: Inspector panels (all 12)

**Files:**
- Create: `src/components/editor/right-sidebar/panels/` (12 files)

**Interfaces:**
- Consumes: `useEditorUiStore`, `useProjectStore`, `usePlayerStore`, window custom events
- Produces: 12 named panel components, each taking no props

---

- [ ] **Step 1: Create the panels directory**

```bash
mkdir -p src/components/editor/right-sidebar/panels
```

- [ ] **Step 2: Create TranscriptPanel.tsx** (functional — wires Transcribe + Toolbox)

Create `src/components/editor/right-sidebar/panels/TranscriptPanel.tsx`:

```tsx
import { MicVocal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toolbox } from "@/components/Toolbox/Toolbox";
import { useProjectStore } from "@/stores/projectStore";
import { useEditorUiStore } from "@/stores/editorUiStore";

export function TranscriptPanel() {
  const hasTranscript = useProjectStore((s) =>
    s.project.segments.some((seg) => seg.words.length > 0),
  );
  const setFindOpen = useEditorUiStore((s) => s.setFindOpen);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Transcription</p>
        <Button
          className="w-full gap-2"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:transcribe"))}
        >
          <MicVocal className="h-4 w-4" />
          {hasTranscript ? "Re-Transcribe" : "Transcribe"}
        </Button>
        <p className="inspector-hint">whisper.cpp · Core ML · Apple Silicon · runs locally</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Edit Tools</p>
        <Toolbox onFindClick={() => setFindOpen(true)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create MediaPanel.tsx** (functional — wires Open, Add Clip, Record, Music, project ops)

Create `src/components/editor/right-sidebar/panels/MediaPanel.tsx`:

```tsx
import { FilePlus2, FolderOpen, History, Music, Power, Radio, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/projectStore";

export function MediaPanel() {
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Import</p>
        <Button
          variant="outline"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:open"))}
        >
          <FolderOpen className="h-4 w-4" />
          Open video file
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          disabled={!hasMedia}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:add-clip"))}
        >
          <Scissors className="h-4 w-4" />
          Add clip
        </Button>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Capture</p>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:record"))}
        >
          <Radio className="h-4 w-4" />
          Record
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:music"))}
        >
          <Music className="h-4 w-4" />
          Music tracks
        </Button>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Project</p>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:new-project"))}
        >
          <FilePlus2 className="h-4 w-4" />
          New project
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:open-project"))}
        >
          <FolderOpen className="h-4 w-4" />
          Open project
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:snapshots"))}
        >
          <History className="h-4 w-4" />
          Snapshots
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start text-destructive hover:text-destructive"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:close-project"))}
        >
          <Power className="h-4 w-4" />
          Close project
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create ExportPanel.tsx** (functional — wires export + captions export)

Create `src/components/editor/right-sidebar/panels/ExportPanel.tsx`:

```tsx
import { Captions, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/projectStore";
import { totalDuration } from "@/lib/edl";
import { formatDuration } from "@/lib/timecode";

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const duration = totalDuration(project);
  const hasContent =
    Object.keys(project.media).length > 0 && project.segments.length > 0;

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Render</p>
        <Button
          className="w-full gap-2"
          disabled={!hasContent}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:export"))}
        >
          <Upload className="h-4 w-4" />
          Export .mp4
        </Button>
        <Button
          variant="outline"
          className="w-full gap-2"
          disabled={!hasContent}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:export-captions"))}
        >
          <Captions className="h-4 w-4" />
          Export captions
        </Button>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Output info</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Duration</span>
          <span className="inspector-row-value">{formatDuration(duration)}</span>
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Format</p>
        <div className="inspector-segmented">
          {["MP4 H.264", "HEVC", "Audio only"].map((f) => (
            <button key={f} className="inspector-segmented-btn" disabled>
              {f}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Format and quality selection coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Quality</p>
        <div className="inspector-segmented">
          {["Draft", "Standard", "High"].map((q) => (
            <button key={q} className="inspector-segmented-btn" disabled>
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create LayoutPanel.tsx** (wires editorUiStore aspect ratio + placeholder controls)

Create `src/components/editor/right-sidebar/panels/LayoutPanel.tsx`:

```tsx
import { useEditorUiStore } from "@/stores/editorUiStore";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3"] as const;
const PRESETS = ["YouTube 1080p", "Shorts / TikTok", "Square post", "Podcast clip"] as const;
const FIT_MODES = ["Fit", "Fill", "100%"] as const;

export function LayoutPanel() {
  const aspectRatio = useEditorUiStore((s) => s.aspectRatio);
  const setAspectRatio = useEditorUiStore((s) => s.setAspectRatio);
  const autoZoomEnabled = useEditorUiStore((s) => s.autoZoomEnabled);
  const setAutoZoomEnabled = useEditorUiStore((s) => s.setAutoZoomEnabled);
  const previewZoom = useEditorUiStore((s) => s.previewZoom);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Canvas</p>
        <div className="inspector-segmented">
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar}
              className={`inspector-segmented-btn${aspectRatio === ar ? " is-active" : ""}`}
              onClick={() => setAspectRatio(ar)}
            >
              {ar}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Presets</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className="inspector-segmented-btn"
              style={{ height: 30, textAlign: "left", paddingLeft: 10 }}
              disabled
            >
              {p}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Preset application coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Preview fit</p>
        <div className="inspector-segmented">
          {FIT_MODES.map((m) => (
            <button key={m} className="inspector-segmented-btn" disabled>
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Auto zoom</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Auto fit</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={autoZoomEnabled}
              onChange={(e) => setAutoZoomEnabled(e.target.checked)}
            />
            <span className="inspector-hint" style={{ margin: 0 }}>
              {autoZoomEnabled ? "On" : "Off"}
            </span>
          </label>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Zoom</span>
          <span className="inspector-row-value">{Math.round(previewZoom * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create the remaining 8 placeholder panels**

Create `src/components/editor/right-sidebar/panels/BackgroundPanel.tsx`:

```tsx
export function BackgroundPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Wallpaper</p>
        <div className="inspector-segmented">
          {["Wallpaper", "Gradient", "Color", "Image"].map((t) => (
            <button key={t} className="inspector-segmented-btn" disabled>
              {t}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Background controls coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Screen</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Padding</span>
          <span className="inspector-row-value">—</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Corners</span>
          <span className="inspector-row-value">—</span>
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Depth</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Shadow</span>
          <span className="inspector-row-value">—</span>
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Device frame</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
        <p className="inspector-hint">Device frame coming soon.</p>
      </div>
    </div>
  );
}
```

Create `src/components/editor/right-sidebar/panels/ScreenPanel.tsx`:

```tsx
export function ScreenPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Transform</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Scale</span>
          <span className="inspector-row-value">100%</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Position X</span>
          <span className="inspector-row-value">—</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Position Y</span>
          <span className="inspector-row-value">—</span>
        </div>
        <p className="inspector-hint">Screen transform controls coming soon.</p>
      </div>
    </div>
  );
}
```

Create `src/components/editor/right-sidebar/panels/CropPanel.tsx`:

```tsx
export function CropPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Crop</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
        {["Top", "Bottom", "Left", "Right"].map((side) => (
          <div key={side} className="inspector-row">
            <span className="inspector-row-label">{side}</span>
            <span className="inspector-row-value">0 px</span>
          </div>
        ))}
        <p className="inspector-hint">Crop controls coming soon.</p>
      </div>
    </div>
  );
}
```

Create `src/components/editor/right-sidebar/panels/AnnotatePanel.tsx`:

```tsx
export function AnnotatePanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Add annotation</p>
        {["Arrow", "Rectangle", "Text", "Highlight"].map((tool) => (
          <button
            key={tool}
            className="inspector-segmented-btn"
            style={{ height: 30, textAlign: "left", paddingLeft: 10, marginBottom: 4, borderRadius: 5, border: "1px solid hsl(var(--border))" }}
            disabled
          >
            {tool}
          </button>
        ))}
        <p className="inspector-hint">Annotation tools coming soon.</p>
      </div>
    </div>
  );
}
```

Create `src/components/editor/right-sidebar/panels/MaskPanel.tsx`:

```tsx
export function MaskPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Mask</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
        <p className="inspector-section-label" style={{ marginTop: 4 }}>Shape</p>
        <div className="inspector-segmented">
          {["Rectangle", "Circle", "Blur area"].map((s) => (
            <button key={s} className="inspector-segmented-btn" disabled>
              {s}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Mask controls coming soon.</p>
      </div>
    </div>
  );
}
```

Create `src/components/editor/right-sidebar/panels/CaptionsPanel.tsx`:

```tsx
export function CaptionsPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Captions</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Style</p>
        <div className="inspector-segmented">
          {["Clean", "Bold", "Subtitle", "Social"].map((s) => (
            <button key={s} className="inspector-segmented-btn" disabled>
              {s}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Caption rendering coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Export</p>
        <button
          className="inspector-segmented-btn"
          style={{ height: 30, width: "100%", borderRadius: 5, border: "1px solid hsl(var(--border))" }}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:export-captions"))}
        >
          Export SRT / VTT
        </button>
      </div>
    </div>
  );
}
```

Create `src/components/editor/right-sidebar/panels/AiPanel.tsx`:

```tsx
export function AiPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Prompt</p>
        <textarea
          disabled
          placeholder="Describe what you want to do…"
          style={{
            width: "100%",
            minHeight: 72,
            resize: "vertical",
            borderRadius: 6,
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--secondary))",
            color: "hsl(var(--muted-foreground))",
            padding: "8px 10px",
            fontSize: 12,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        />
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Quick actions</p>
        {[
          "Remove filler words",
          "Cut to 60 seconds",
          "Remove silence",
          "Find quote",
          "Summarise chapters",
        ].map((action) => (
          <button
            key={action}
            className="inspector-segmented-btn"
            style={{ height: 30, textAlign: "left", paddingLeft: 10, marginBottom: 4, borderRadius: 5, border: "1px solid hsl(var(--border))" }}
            disabled
          >
            {action}
          </button>
        ))}
        <p className="inspector-hint">
          AI suggestions must be reviewed before applying edits.
        </p>
      </div>
    </div>
  );
}
```

Create `src/components/editor/right-sidebar/panels/SettingsPanel.tsx`:

```tsx
export function SettingsPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Editor</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Cut padding</span>
          <span className="inspector-row-value">—</span>
        </div>
        <p className="inspector-hint">Cut padding and editor settings coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Storage</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Model storage</span>
          <span className="inspector-row-value">—</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Cache</span>
          <span className="inspector-row-value">—</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run typecheck to verify all panels**

```bash
npm run typecheck 2>&1 | grep "error"
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/editor/right-sidebar/panels/
git commit -m "feat: add 12 inspector panel components"
```

---

### Task 6: RightInspectorPanel and RightEditorSidebar

**Files:**
- Create: `src/components/editor/right-sidebar/RightInspectorPanel.tsx`
- Create: `src/components/editor/right-sidebar/RightEditorSidebar.tsx`

**Interfaces:**
- Consumes: `useEditorUiStore` (activeRightPanel, inspectorOpen), all 12 panel components
- Produces: `RightInspectorPanel` (no props), `RightEditorSidebar` (no props)

---

- [ ] **Step 1: Create RightInspectorPanel.tsx**

Create `src/components/editor/right-sidebar/RightInspectorPanel.tsx`:

```tsx
import { useEditorUiStore, type RightEditorPanel } from "@/stores/editorUiStore";
import { LayoutPanel } from "./panels/LayoutPanel";
import { BackgroundPanel } from "./panels/BackgroundPanel";
import { ScreenPanel } from "./panels/ScreenPanel";
import { CropPanel } from "./panels/CropPanel";
import { AnnotatePanel } from "./panels/AnnotatePanel";
import { MaskPanel } from "./panels/MaskPanel";
import { TranscriptPanel } from "./panels/TranscriptPanel";
import { CaptionsPanel } from "./panels/CaptionsPanel";
import { AiPanel } from "./panels/AiPanel";
import { MediaPanel } from "./panels/MediaPanel";
import { ExportPanel } from "./panels/ExportPanel";
import { SettingsPanel } from "./panels/SettingsPanel";

const PANEL_COMPONENTS: Record<RightEditorPanel, React.FC> = {
  layout: LayoutPanel,
  background: BackgroundPanel,
  screen: ScreenPanel,
  crop: CropPanel,
  annotate: AnnotatePanel,
  mask: MaskPanel,
  transcript: TranscriptPanel,
  captions: CaptionsPanel,
  ai: AiPanel,
  media: MediaPanel,
  export: ExportPanel,
  settings: SettingsPanel,
};

const PANEL_LABELS: Record<RightEditorPanel, string> = {
  layout: "Layout",
  background: "Background",
  screen: "Screen",
  crop: "Crop",
  annotate: "Annotate",
  mask: "Mask",
  transcript: "Transcript",
  captions: "Captions",
  ai: "AI",
  media: "Media",
  export: "Export",
  settings: "Settings",
};

export function RightInspectorPanel() {
  const activeRightPanel = useEditorUiStore((s) => s.activeRightPanel);
  const inspectorOpen = useEditorUiStore((s) => s.inspectorOpen);

  const PanelComponent = PANEL_COMPONENTS[activeRightPanel];

  return (
    <div
      className="right-inspector-panel"
      style={{ width: inspectorOpen ? 320 : 0 }}
      aria-hidden={!inspectorOpen}
    >
      {inspectorOpen && (
        <>
          <div className="inspector-panel-header">
            <span className="inspector-panel-title">{PANEL_LABELS[activeRightPanel]}</span>
          </div>
          <div className="inspector-panel-scroll">
            <PanelComponent />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create RightEditorSidebar.tsx**

Create `src/components/editor/right-sidebar/RightEditorSidebar.tsx`:

```tsx
import { RightToolRail } from "./RightToolRail";
import { RightInspectorPanel } from "./RightInspectorPanel";

export function RightEditorSidebar() {
  return (
    <div className="right-editor-sidebar">
      <RightToolRail />
      <RightInspectorPanel />
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck 2>&1 | grep "error"
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/right-sidebar/RightInspectorPanel.tsx \
        src/components/editor/right-sidebar/RightEditorSidebar.tsx
git commit -m "feat: add RightInspectorPanel and RightEditorSidebar"
```

---

### Task 7: PreviewWorkspace and BottomTimeline

**Files:**
- Create: `src/components/editor/PreviewWorkspace.tsx`
- Create: `src/components/editor/BottomTimeline.tsx`

**Interfaces:**
- Consumes: `VideoPreview` component, `Waveform` component, `useEditorUiStore` (aspectRatio, autoZoomEnabled, setPreviewZoom)
- Produces: `PreviewWorkspace` (no props), `BottomTimeline` (no props)

---

- [ ] **Step 1: Create PreviewWorkspace.tsx**

Create `src/components/editor/PreviewWorkspace.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { VideoPreview } from "@/components/VideoPreview/VideoPreview";
import { useEditorUiStore } from "@/stores/editorUiStore";

const CANVAS_DIMENSIONS: Record<string, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:3": [1440, 1080],
};

export function PreviewWorkspace() {
  const containerRef = useRef<HTMLDivElement>(null);
  const aspectRatio = useEditorUiStore((s) => s.aspectRatio);
  const autoZoomEnabled = useEditorUiStore((s) => s.autoZoomEnabled);
  const setPreviewZoom = useEditorUiStore((s) => s.setPreviewZoom);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !autoZoomEnabled) return;

    const [canvasW, canvasH] = CANVAS_DIMENSIONS[aspectRatio] ?? [1920, 1080];

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      const zoom = Math.min(width / canvasW, height / canvasH);
      setPreviewZoom(Math.max(0.25, Math.min(2.0, zoom)));
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [aspectRatio, autoZoomEnabled, setPreviewZoom]);

  return (
    <div ref={containerRef} className="preview-workspace">
      <VideoPreview />
    </div>
  );
}
```

- [ ] **Step 2: Create BottomTimeline.tsx**

Create `src/components/editor/BottomTimeline.tsx`:

```tsx
import { Waveform } from "@/components/Waveform/Waveform";

/**
 * Bottom timeline area — currently wraps the waveform/clip overview.
 * This area will grow into the full transcript/clip timeline in a future pass.
 */
export function BottomTimeline() {
  return (
    <div className="bottom-timeline">
      <Waveform />
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck 2>&1 | grep "error"
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/PreviewWorkspace.tsx \
        src/components/editor/BottomTimeline.tsx
git commit -m "feat: add PreviewWorkspace with ResizeObserver auto-fit and BottomTimeline"
```

---

### Task 8: Refactor Toolbar.tsx to dialogs-only

**Files:**
- Modify: `src/components/Toolbar/Toolbar.tsx`

**Interfaces:**
- Consumes: (unchanged) all IPC functions, projectStore, uiStore, playerStore
- Produces: `Toolbar` component with **no props**, renders only dialog JSX, emits no toolbar chrome

The `ToolbarProps` interface is removed. The `onFindClick` prop is removed. New `useEffect` blocks listen for additional custom events. The JSX `return` replaces the `<div className="editor-toolbar">` tree with a React fragment of only the dialogs.

---

- [ ] **Step 1: Remove the ToolbarProps interface and prop from the function signature**

In `src/components/Toolbar/Toolbar.tsx`, find and remove lines 150–152:

```ts
interface ToolbarProps {
  onFindClick?: () => void;
}
```

Change the function signature from:

```ts
export function Toolbar({ onFindClick }: ToolbarProps) {
```

to:

```ts
export function Toolbar() {
```

- [ ] **Step 2: Remove the unused Toolbox import**

Remove the line:

```ts
import { Toolbox } from "@/components/Toolbox/Toolbox";
```

- [ ] **Step 3: Remove unused icon imports**

Remove these icons that were only used in toolbar chrome (not in dialogs). Find the lucide-react import block and remove: `ChevronDown`, `FolderOpen` (keep for dialogs check), `FilePlus2`, `MicVocal` (keep — used in transcribe dialog title), `MonitorUp`, `Music`, `Power`, `Radio`, `Save`, `Scissors` (keep — used in export dialog), `Settings2`, `Square`, `Video`.

The final lucide-react import should be:

```ts
import {
  Captions,
  CheckCircle2,
  Download,
  FolderOpen,
  MicVocal,
  Radio,
  Scissors,
  Settings2,
  Square,
  Video,
  MonitorUp,
} from "lucide-react";
```

*(Keep all icons that appear in dialog JSX. Keep `Radio`, `Square`, `Video`, `MonitorUp` for the record dialog. Keep `FolderOpen` for the media loading dialog. Remove `ChevronDown`, `FilePlus2`, `Music`, `Power`, `Save`, `MicVocal` only if not in dialogs — verify by searching each in the dialog JSX before removing.)*

**Safe approach:** search for each icon name in the dialog JSX (lines 916–1454) before removing. Keep any icon used there.

- [ ] **Step 4: Add new event listeners to the existing useEffect**

Find the existing event listener `useEffect` (around line 799):

```ts
useEffect(() => {
  window.addEventListener("yusafcut:save", handleSave);
  window.addEventListener("yusafcut:export", handleExport);
  return () => {
    window.removeEventListener("yusafcut:save", handleSave);
    window.removeEventListener("yusafcut:export", handleExport);
  };
}, [handleSave, handleExport]);
```

Replace it with:

```ts
useEffect(() => {
  const onTranscribe = () => {
    if (hasTranscript) {
      void handleReTranscribe();
    } else {
      void handleTranscribe();
    }
  };
  const onOpen = () => void handleOpen();
  const onAddClip = () => void handleAddClip();
  const onRecord = () => setRecordDialogOpen(true);
  const onMusic = () => setMusicDialogOpen(true);
  const onSnapshots = () => setSnapshotsDialogOpen(true);
  const onExportCaptions = () => void handleExportCaptions();
  const onNewProject = () => handleNewProject();
  const onOpenProject = () => void handleOpenProject();
  const onCloseProject = () => handleCloseProject();

  window.addEventListener("yusafcut:save", handleSave);
  window.addEventListener("yusafcut:export", handleExport);
  window.addEventListener("yusafcut:transcribe", onTranscribe);
  window.addEventListener("yusafcut:open", onOpen);
  window.addEventListener("yusafcut:add-clip", onAddClip);
  window.addEventListener("yusafcut:record", onRecord);
  window.addEventListener("yusafcut:music", onMusic);
  window.addEventListener("yusafcut:snapshots", onSnapshots);
  window.addEventListener("yusafcut:export-captions", onExportCaptions);
  window.addEventListener("yusafcut:new-project", onNewProject);
  window.addEventListener("yusafcut:open-project", onOpenProject);
  window.addEventListener("yusafcut:close-project", onCloseProject);

  return () => {
    window.removeEventListener("yusafcut:save", handleSave);
    window.removeEventListener("yusafcut:export", handleExport);
    window.removeEventListener("yusafcut:transcribe", onTranscribe);
    window.removeEventListener("yusafcut:open", onOpen);
    window.removeEventListener("yusafcut:add-clip", onAddClip);
    window.removeEventListener("yusafcut:record", onRecord);
    window.removeEventListener("yusafcut:music", onMusic);
    window.removeEventListener("yusafcut:snapshots", onSnapshots);
    window.removeEventListener("yusafcut:export-captions", onExportCaptions);
    window.removeEventListener("yusafcut:new-project", onNewProject);
    window.removeEventListener("yusafcut:open-project", onOpenProject);
    window.removeEventListener("yusafcut:close-project", onCloseProject);
  };
}, [
  handleSave,
  handleExport,
  handleTranscribe,
  handleReTranscribe,
  handleExportCaptions,
  handleNewProject,
  handleOpenProject,
  handleCloseProject,
  hasTranscript,
]);
```

- [ ] **Step 5: Replace the return statement with dialogs-only fragment**

Find the `return (` at line ~808. Replace everything from `return (` to the closing `);` with:

```tsx
  return (
    <>
      <Dialog
        open={recordDialogOpen}
        onOpenChange={(open) => {
          if (!recording) setRecordDialogOpen(open);
        }}
      >
        {/* ... keep existing record dialog content exactly as-is ... */}
      </Dialog>

      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        {/* ... keep existing model dialog content exactly as-is ... */}
      </Dialog>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        {/* ... keep existing export dialog content exactly as-is ... */}
      </Dialog>

      <Dialog open={transcribeProgress !== null} onOpenChange={() => undefined}>
        {/* ... keep exactly as-is ... */}
      </Dialog>

      <Dialog open={mediaLoading} onOpenChange={() => undefined}>
        {/* ... keep exactly as-is ... */}
      </Dialog>

      <Dialog open={exportingProgress !== null} onOpenChange={() => undefined}>
        {/* ... keep exactly as-is ... */}
      </Dialog>

      <Dialog open={modelDownloadProgress !== null} onOpenChange={() => undefined}>
        {/* ... keep exactly as-is ... */}
      </Dialog>

      <MusicTracksDialog open={musicDialogOpen} onOpenChange={setMusicDialogOpen} />
      <SnapshotsDialog open={snapshotsDialogOpen} onOpenChange={setSnapshotsDialogOpen} />
    </>
  );
```

**Precisely:** The return value must be a React fragment (`<>...</>`) containing only the 7 `<Dialog>` elements, `<MusicTracksDialog>`, and `<SnapshotsDialog>`. Remove the outer `<div className="editor-toolbar">`, `<div className="editor-toolbar-top">`, `<div className="editor-toolbar-bottom">`, all `<Button>` toolbar elements, and the `<Toolbox />` render. Keep every `<Dialog>` and its content unchanged.

Also remove the `toolbarBottomRef` ref declaration (`const toolbarBottomRef = useRef<HTMLDivElement>(null)`) since it's no longer used.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck 2>&1 | grep "error"
```

Fix any errors. Common ones: unused import warnings treated as errors by ESLint; icon imports no longer used.

- [ ] **Step 7: Run lint**

```bash
npm run lint 2>&1 | head -40
```

Fix any unused import errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Toolbar/Toolbar.tsx
git commit -m "refactor: gut Toolbar to dialogs-only; add event listeners for sidebar panels"
```

---

### Task 9: EditorLayout and App.tsx refactor

**Files:**
- Create: `src/components/editor/EditorLayout.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `TopBar`, `PreviewWorkspace`, `BottomTimeline`, `RightEditorSidebar`, `TranscriptEditor`, `StatusBar`, `Toolbar`, `useProjectStore`, `useEditorUiStore`
- Produces: `EditorLayout` (no props); `App` renders `<EditorLayout />` + global overlays

---

- [ ] **Step 1: Create EditorLayout.tsx**

Create `src/components/editor/EditorLayout.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { PreviewWorkspace } from "./PreviewWorkspace";
import { BottomTimeline } from "./BottomTimeline";
import { RightEditorSidebar } from "./right-sidebar/RightEditorSidebar";
import { TranscriptEditor } from "@/components/TranscriptEditor/TranscriptEditor";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { Toolbar } from "@/components/Toolbar/Toolbar";
import { useProjectStore } from "@/stores/projectStore";
import { useEditorUiStore } from "@/stores/editorUiStore";

const MIN_VIDEO_WIDTH = 360;
const MAX_VIDEO_WIDTH = 1100;
const DEFAULT_VIDEO_WIDTH = 560;
const STORAGE_KEY = "yusafcut.videoPanelWidth";

export function EditorLayout() {
  const hasTranscript = useProjectStore((s) =>
    s.project.segments.some((seg) => seg.words.length > 0),
  );
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);

  const findOpen = useEditorUiStore((s) => s.findOpen);
  const setFindOpen = useEditorUiStore((s) => s.setFindOpen);

  const [videoWidth, setVideoWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_VIDEO_WIDTH;
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) && parsed >= MIN_VIDEO_WIDTH && parsed <= MAX_VIDEO_WIDTH
      ? parsed
      : DEFAULT_VIDEO_WIDTH;
  });

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, String(videoWidth));
    } catch {
      /* ignore */
    }
  }, [videoWidth]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - e.clientX;
      const next = Math.max(
        MIN_VIDEO_WIDTH,
        Math.min(MAX_VIDEO_WIDTH, dragRef.current.startWidth + delta),
      );
      setVideoWidth(next);
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    dragRef.current = { startX: e.clientX, startWidth: videoWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {hasTranscript && (
          <>
            <main className="relative flex min-w-0 flex-1 overflow-hidden border-r border-border">
              <TranscriptEditor
                findOpen={findOpen}
                onFindOpen={() => setFindOpen(true)}
                onFindClose={() => setFindOpen(false)}
              />
            </main>

            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              onDoubleClick={() => setVideoWidth(DEFAULT_VIDEO_WIDTH)}
              className="group relative w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
              title="Drag to resize · double-click to reset"
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
              <div className="absolute inset-y-1/2 left-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/50 group-hover:bg-foreground/30" />
            </div>
          </>
        )}

        {/*
         * IMPORTANT: keep a single VideoPreview instance across both layout states.
         * We change className/style on this wrapper but never unmount it — unmounting
         * would drop the loaded <video> source and decoded buffers.
         */}
        <div
          className={
            hasTranscript
              ? "contents"
              : "flex flex-1 flex-col items-center justify-center overflow-hidden gap-5 px-8"
          }
        >
          <aside
            className={
              hasTranscript
                ? "flex h-full shrink-0 flex-col overflow-hidden bg-black"
                : "flex w-full max-w-[900px] flex-col overflow-hidden rounded-2xl bg-black shadow-[0_8px_48px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.07]"
            }
            style={hasTranscript ? { width: videoWidth } : { height: "min(560px, 65vh)" }}
          >
            <PreviewWorkspace />
          </aside>

          {!hasTranscript && (
            <p className="text-sm text-muted-foreground/70">
              {hasMedia ? (
                <>
                  Click{" "}
                  <span className="font-semibold text-foreground/80">Transcript</span> in the
                  right panel to transcribe and start editing
                </>
              ) : (
                <>
                  Use the{" "}
                  <span className="font-semibold text-foreground/80">Media</span> panel on the
                  right to open a video file
                </>
              )}
            </p>
          )}
        </div>

        <RightEditorSidebar />
      </div>

      {hasMedia && <BottomTimeline />}

      <StatusBar />

      {/* Toolbar renders only its dialogs — no visible chrome */}
      <Toolbar />
    </div>
  );
}
```

- [ ] **Step 2: Rewrite App.tsx**

Replace the entire content of `src/App.tsx` with:

```tsx
import { useEffect } from "react";
import { EditorLayout } from "@/components/editor/EditorLayout";
import { ProcessingOverlay } from "@/components/ProcessingOverlay";
import { Toaster } from "@/components/ui/toaster";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useTranscribeProgress } from "@/hooks/useTranscribeProgress";
import { useProjectStore } from "@/stores/projectStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useUIStore } from "@/stores/uiStore";
import { initJobsStream } from "@/stores/jobsStore";
import { importMedia } from "@/lib/ipc";
import { readTranscriptCache } from "@/lib/transcriptCache";
import { totalDuration } from "@/lib/edl";
import { getCurrentWebview } from "@tauri-apps/api/webview";

const MEDIA_DROP_EXTENSIONS = new Set(["mp4", "mov", "m4v", "mkv", "webm", "m4a", "wav"]);

function isSupportedMediaPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension ? MEDIA_DROP_EXTENSIONS.has(extension) : false;
}

export default function App() {
  useKeyboardShortcuts();
  useAutoSave();
  useTranscribeProgress();

  const pushToast = useUIStore((s) => s.pushToast);
  const setMediaLoading = useUIStore((s) => s.setMediaLoading);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void initJobsStream().then((dispose) => {
      if (cancelled) dispose();
      else unlisten = dispose;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    if (!("__TAURI_INTERNALS__" in window)) return;

    async function addDroppedClip(path: string) {
      if (!isSupportedMediaPath(path)) {
        pushToast({
          title: "Unsupported file",
          description: "Drop an MP4, MOV, MKV, WebM, M4A, or WAV file.",
          variant: "destructive",
        });
        return;
      }
      setMediaLoading(true);
      try {
        const before = useProjectStore.getState().project;
        const appendAt = totalDuration(before);
        const media = await importMedia(path);
        const cachedWords = readTranscriptCache(media) ?? [];
        useProjectStore.getState().addMediaWithTranscript(media, cachedWords);
        usePlayerStore.getState().clearTimelineRange();
        usePlayerStore.getState().setSelectedWordIds(new Set());
        window.dispatchEvent(
          new CustomEvent("yusafcut:seek-output", { detail: { time: appendAt } }),
        );
        pushToast({
          title:
            cachedWords.length > 0
              ? "Dropped clip added with cached transcript"
              : "Dropped clip added",
          description:
            cachedWords.length > 0
              ? media.path
              : "Use the Transcript panel to transcribe this clip.",
        });
      } catch (err) {
        pushToast({
          title: "Failed to add dropped clip",
          description: String(err),
          variant: "destructive",
        });
      } finally {
        setMediaLoading(false);
      }
    }

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const mediaPath =
          event.payload.paths.find(isSupportedMediaPath) ?? event.payload.paths[0];
        if (mediaPath) void addDroppedClip(mediaPath);
      })
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        // Browser-only preview does not expose Tauri drag/drop events.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [pushToast, setMediaLoading]);

  return (
    <>
      <EditorLayout />
      <ProcessingOverlay />
      <Toaster />
    </>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck 2>&1 | grep "error"
```

Fix any errors before proceeding.

- [ ] **Step 4: Run lint**

```bash
npm run lint 2>&1 | head -40
```

Fix any lint errors.

- [ ] **Step 5: Run unit tests**

```bash
npm test
```

Expected: All existing tests pass; the 8 new `editorUiStore` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/EditorLayout.tsx src/App.tsx
git commit -m "feat: add EditorLayout and refactor App to thin shell"
```

---

### Task 10: Version bump, docs, and branch push

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture.md`

---

- [ ] **Step 1: Run the full check suite one final time**

```bash
npm run check && npm test
```

Expected: All checks pass, all tests pass. Fix anything before continuing.

- [ ] **Step 2: Bump version in package.json**

Change `"version": "4.3.0"` to `"version": "4.4.0"`.

- [ ] **Step 3: Bump version in src-tauri/Cargo.toml**

Change `version = "4.3.0"` (under `[package]`) to `version = "4.4.0"`.

- [ ] **Step 4: Bump version in src-tauri/tauri.conf.json**

Change `"version": "4.3.0"` to `"version": "4.4.0"`.

- [ ] **Step 5: Update CHANGELOG.md**

Add this block at the top of the changelog (below the title, above any existing `[Unreleased]` or previous version):

```markdown
## [4.4.0] — 2026-06-28

### Added
- Right-side editor sidebar: 52 px icon rail with 12 panels (Layout, Background, Screen, Crop, Annotate, Mask, Transcript, Captions, AI, Media, Export, Settings)
- Right inspector panel (320 px, collapsible) driven by the active rail icon
- `editorUiStore` — UI state for active panel, aspect ratio, preview zoom, auto-fit zoom, find-in-transcript open state
- `EditorLayout` component — root shell with drag-resize, TopBar, RightEditorSidebar, BottomTimeline
- `TopBar` — minimal 40 px bar with project name, dirty indicator, Save, Undo, Redo buttons
- `PreviewWorkspace` — wraps VideoPreview with ResizeObserver auto-fit zoom tracking
- `BottomTimeline` — wraps the waveform with a clear timeline section boundary

### Changed
- `Toolbar` component now renders only its modal dialogs; all toolbar chrome removed
- All file/project actions (Open, Add Clip, Record, Music, New/Open/Close Project, Snapshots) moved to the Media panel
- Export .mp4 and caption export moved to the Export panel
- Transcribe / Re-Transcribe moved to the Transcript panel
- Toolbox editing tools (Select, Find, Markers, Edit, Zoom) moved to the Transcript panel
- `App.tsx` reduced to hooks, drag-drop wiring, and global overlay rendering
- Welcome screen copy updated to reference the Media and Transcript panels
```

- [ ] **Step 6: Update docs/architecture.md**

Find the "Frontend layout" section and update the component list to reflect the new structure. Add `EditorLayout`, `TopBar`, `PreviewWorkspace`, `BottomTimeline`, `RightEditorSidebar`, `RightToolRail`, `RightInspectorPanel`, and `editorUiStore` to the relevant sections. Note that `Toolbar` is now dialogs-only.

- [ ] **Step 7: Commit and push**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json \
        CHANGELOG.md docs/architecture.md
git commit -m "chore: bump to 4.4.0; update changelog and architecture docs"
git push -u origin feature/right-sidebar-ui
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| TopBar ≤48px, project name, Save, Undo, Redo | Task 3 |
| 12-icon rail, active state, hover, tooltip, keyboard | Task 4 |
| Inspector 300–340px, dark, collapsible | Tasks 6, 2 (CSS) |
| editorUiStore with activeRightPanel, aspectRatio, previewZoom, autoZoomEnabled | Task 1 |
| Clicking active icon collapses inspector | Task 1 (setActiveRightPanel toggles) |
| TranscriptPanel: Transcribe button + Toolbox | Task 5 |
| MediaPanel: Open, Add Clip, Record, Music, project ops | Task 5 |
| ExportPanel: Export .mp4 + captions + placeholders | Task 5 |
| LayoutPanel: aspect ratio segmented, presets, auto zoom | Task 5 |
| Background, Screen, Crop, Annotate, Mask, Captions, AI, Settings panels | Task 5 |
| PreviewWorkspace with ResizeObserver auto-fit | Task 7 |
| BottomTimeline wraps Waveform | Task 7 |
| Single VideoPreview instance preserved | Task 9 (contents wrapper) |
| Toolbar dialogs-only | Task 8 |
| New custom events for all sidebar CTAs | Task 8 |
| findOpen in editorUiStore, read by EditorLayout → TranscriptEditor | Tasks 1, 5, 9 |
| Version bump 4.3.0 → 4.4.0 | Task 10 |
| typecheck + lint pass | Tasks 8, 9, 10 |

**Placeholder scan:** No TBDs. All placeholder panels have complete styled JSX (disabled controls with `inspector-hint` text). No "similar to Task N" references — each panel is written in full.

**Type consistency check:**
- `RightEditorPanel` exported from `editorUiStore.ts` and consumed by `RightToolRail`, `RightInspectorPanel` — consistent.
- `useEditorUiStore` — all call sites use the same selector shape.
- `Toolbox` `onFindClick` prop — provided by `TranscriptPanel` via `setFindOpen` from `editorUiStore`.
- `TranscriptEditor` props (`findOpen`, `onFindOpen`, `onFindClose`) — provided by `EditorLayout` reading `findOpen` from `editorUiStore`.
- `useTemporalProjectStore` imported in `TopBar` — exported from `projectStore.ts` at line 451.
