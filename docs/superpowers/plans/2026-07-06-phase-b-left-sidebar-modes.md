# Phase B: Left Sidebar + Workspace Modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the editor sidebar to the left with a restored icon rail, introduce `Transcribe | Edit` workspace modes, move project actions into a TopBar Project menu, and make panels a declarative registry (spec section B of `docs/superpowers/specs/2026-07-06-editing-accuracy-and-left-sidebar-design.md`).

**Architecture:** `editorUiStore` gains `workspaceMode`; a panel registry (`registry.tsx`) declares which panels exist per mode; `components/editor/right-sidebar/` is replaced by `components/editor/sidebar/` (rail + inspector) rendered on the LEFT of `EditorLayout`; `CombinedPanel` is split into five focused panels; TopBar gains a Project dropdown, mode toggle, and recents.

**Tech Stack:** React 18, Zustand, TipTap (`editor.setEditable`), Tailwind + the existing `globals.css` sidebar classes, Vitest.

## Global Constraints

- Branch: create `feature/left-sidebar-modes` **from `feature/dtw-word-sync`** (Phase A's branch — the phases stack; main is still at 4.3.0).
- Never mention Claude, AI, or AI assistance in commits, code comments, or docs. No Co-Authored-By tags.
- Version bump to **4.6.0** in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (Task 7).
- Docs updated in the same commit as the code they describe.
- Prettier: double quotes, semicolons, trailing commas, 100-char width, 2-space indent. ESLint `--max-warnings=0`.
- Commit and push only — never create a PR or merge.
- **Non-regression:** every action reachable in v4.4.0/v4.5.0 stays reachable. All `yusafcut:*` window events keep their names — Toolbar.tsx listeners are the contract.
- **Single `<video>` invariant:** `PreviewWorkspace` must never unmount when layout or mode changes (CSS/JSX-order changes only).

---

### Task 0: Branch setup

- [ ] **Step 1: Create the branch**

```bash
cd /Users/mohr/code/projects/yusaf-cut
git checkout feature/dtw-word-sync
git checkout -b feature/left-sidebar-modes
```

---

### Task 1: Workspace mode in `editorUiStore`

**Files:**
- Modify: `src/stores/editorUiStore.ts` (full rewrite below)
- Test: `tests/editorUiStore.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2-6):
  - `type WorkspaceMode = "transcribe" | "edit"`
  - `workspaceMode: WorkspaceMode` (initial `"edit"`), `setWorkspaceMode(mode)` — switching mode resets `activePanel` to that mode's default and opens the inspector.
  - `activePanel: string` (was `activeRightPanel: "main"`), `setActivePanel(panelId)` — clicking the active panel toggles `inspectorOpen`, clicking another switches and opens.
  - `DEFAULT_PANEL: Record<WorkspaceMode, string>` = `{ transcribe: "transcribe", edit: "edit-tools" }` (exported — the registry test in Task 2 asserts these ids exist).

- [ ] **Step 1: Write the failing tests**

Create `tests/editorUiStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PANEL, useEditorUiStore } from "@/stores/editorUiStore";

describe("editorUiStore workspace modes", () => {
  beforeEach(() => {
    useEditorUiStore.setState({
      workspaceMode: "edit",
      activePanel: DEFAULT_PANEL.edit,
      inspectorOpen: true,
    });
  });

  it("switching mode resets the active panel to that mode's default and opens the inspector", () => {
    useEditorUiStore.setState({ inspectorOpen: false, activePanel: "export" });
    useEditorUiStore.getState().setWorkspaceMode("transcribe");
    const s = useEditorUiStore.getState();
    expect(s.workspaceMode).toBe("transcribe");
    expect(s.activePanel).toBe(DEFAULT_PANEL.transcribe);
    expect(s.inspectorOpen).toBe(true);
  });

  it("setting the same mode is a no-op (keeps panel and inspector state)", () => {
    useEditorUiStore.setState({ activePanel: "export", inspectorOpen: false });
    useEditorUiStore.getState().setWorkspaceMode("edit");
    const s = useEditorUiStore.getState();
    expect(s.activePanel).toBe("export");
    expect(s.inspectorOpen).toBe(false);
  });

  it("clicking the active panel toggles the inspector", () => {
    useEditorUiStore.getState().setActivePanel(DEFAULT_PANEL.edit);
    expect(useEditorUiStore.getState().inspectorOpen).toBe(false);
    useEditorUiStore.getState().setActivePanel(DEFAULT_PANEL.edit);
    expect(useEditorUiStore.getState().inspectorOpen).toBe(true);
  });

  it("clicking a different panel activates it and opens the inspector", () => {
    useEditorUiStore.setState({ inspectorOpen: false });
    useEditorUiStore.getState().setActivePanel("export");
    const s = useEditorUiStore.getState();
    expect(s.activePanel).toBe("export");
    expect(s.inspectorOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/editorUiStore.test.ts`
Expected: FAIL — `DEFAULT_PANEL` / `workspaceMode` / `setActivePanel` don't exist.

- [ ] **Step 3: Rewrite the store**

Replace `src/stores/editorUiStore.ts` with:

```ts
import { create } from "zustand";

export type WorkspaceMode = "transcribe" | "edit";

/**
 * Default panel per mode. Kept here (not in the panel registry) so the store
 * has no component imports — the registry test asserts these ids exist.
 */
export const DEFAULT_PANEL: Record<WorkspaceMode, string> = {
  transcribe: "transcribe",
  edit: "edit-tools",
};

interface EditorUiState {
  workspaceMode: WorkspaceMode;
  activePanel: string;
  inspectorOpen: boolean;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3";
  previewZoom: number;
  autoZoomEnabled: boolean;
  findOpen: boolean;

  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setActivePanel: (panel: string) => void;
  setAspectRatio: (ar: "16:9" | "9:16" | "1:1" | "4:3") => void;
  setPreviewZoom: (zoom: number) => void;
  setAutoZoomEnabled: (enabled: boolean) => void;
  setFindOpen: (open: boolean) => void;
}

export const useEditorUiStore = create<EditorUiState>((set, get) => ({
  workspaceMode: "edit",
  activePanel: DEFAULT_PANEL.edit,
  inspectorOpen: true,
  aspectRatio: "16:9",
  previewZoom: 1,
  autoZoomEnabled: true,
  findOpen: false,

  setWorkspaceMode: (mode) => {
    if (mode === get().workspaceMode) return;
    set({ workspaceMode: mode, activePanel: DEFAULT_PANEL[mode], inspectorOpen: true });
  },
  setActivePanel: (panel) => {
    const { activePanel, inspectorOpen } = get();
    if (panel === activePanel) {
      set({ inspectorOpen: !inspectorOpen });
    } else {
      set({ activePanel: panel, inspectorOpen: true });
    }
  },
  setAspectRatio: (ar) => set({ aspectRatio: ar }),
  setPreviewZoom: (zoom) => set({ previewZoom: zoom }),
  setAutoZoomEnabled: (enabled) => set({ autoZoomEnabled: enabled }),
  setFindOpen: (open) => set({ findOpen: open }),
}));
```

Note: `RightEditorPanel` type and `activeRightPanel`/`setActiveRightPanel` are deleted. `RightToolRail.tsx` (the only consumer) is deleted in Task 3 — until then the typecheck will fail, which is expected mid-task; Tasks 1-3 land as one coherent sequence before running `npm run check`.

- [ ] **Step 4: Run the store tests**

Run: `npx vitest run tests/editorUiStore.test.ts`
Expected: PASS (4 tests). (`npm run check` is deferred to Task 3 Step 6 because the old rail still references removed store fields.)

- [ ] **Step 5: Commit**

```bash
git add src/stores/editorUiStore.ts tests/editorUiStore.test.ts
git commit -m "feat: add workspace modes to editor UI store"
```

---

### Task 2: Panel registry and the five focused panels

**Files:**
- Create: `src/components/editor/sidebar/registry.tsx`
- Create: `src/components/editor/sidebar/panels/MediaPanel.tsx`
- Create: `src/components/editor/sidebar/panels/TranscribePanel.tsx`
- Create: `src/components/editor/sidebar/panels/EditToolsPanel.tsx`
- Create: `src/components/editor/sidebar/panels/MusicPanel.tsx`
- Create: `src/components/editor/sidebar/panels/ExportPanel.tsx`
- Test: `tests/panelRegistry.test.ts`

**Interfaces:**
- Produces:
  - `interface PanelDef { id: string; icon: LucideIcon; label: string; modes: WorkspaceMode[]; component: React.FC; }`
  - `PANELS: PanelDef[]`, `panelsForMode(mode: WorkspaceMode): PanelDef[]`
- Consumes: `WorkspaceMode`, `DEFAULT_PANEL` from Task 1; all panel content transplanted from `panels/CombinedPanel.tsx` (event names unchanged).

- [ ] **Step 1: Write the failing registry test**

Create `tests/panelRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PANELS, panelsForMode } from "@/components/editor/sidebar/registry";
import { DEFAULT_PANEL } from "@/stores/editorUiStore";

describe("panel registry", () => {
  it("has unique panel ids", () => {
    const ids = PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters panels by workspace mode", () => {
    for (const p of panelsForMode("transcribe")) expect(p.modes).toContain("transcribe");
    for (const p of panelsForMode("edit")) expect(p.modes).toContain("edit");
  });

  it("exposes the expected panels per mode", () => {
    expect(panelsForMode("transcribe").map((p) => p.id)).toEqual(["media", "transcribe"]);
    expect(panelsForMode("edit").map((p) => p.id)).toEqual(["edit-tools", "music", "export"]);
  });

  it("each mode's default panel exists in that mode", () => {
    expect(panelsForMode("transcribe").some((p) => p.id === DEFAULT_PANEL.transcribe)).toBe(true);
    expect(panelsForMode("edit").some((p) => p.id === DEFAULT_PANEL.edit)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/panelRegistry.test.ts`
Expected: FAIL — registry module does not exist.

- [ ] **Step 3: Create the five panel components**

`src/components/editor/sidebar/panels/MediaPanel.tsx` (media-specific only — project lifecycle moves to the TopBar in Task 5):

```tsx
import { Music, Radio, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/projectStore";

export function MediaPanel() {
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Import</p>
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
      <p className="inspector-hint">Open a video or project from the Project menu in the top bar.</p>
    </div>
  );
}
```

> Note: the Music button also stays reachable here in transcribe mode (import-adjacent), while the dedicated Music panel lives in edit mode — reachability, not exclusivity, is the non-regression bar.

`src/components/editor/sidebar/panels/TranscribePanel.tsx`:

```tsx
import { ArrowRight, MicVocal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorUiStore } from "@/stores/editorUiStore";
import { useProjectStore } from "@/stores/projectStore";

export function TranscribePanel() {
  const hasTranscript = useProjectStore((s) =>
    s.project.segments.some((seg) => seg.words.length > 0),
  );
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);
  const setWorkspaceMode = useEditorUiStore((s) => s.setWorkspaceMode);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Transcription</p>
        <Button
          className="w-full gap-2"
          disabled={!hasMedia}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:transcribe"))}
        >
          <MicVocal className="h-4 w-4" />
          {hasTranscript ? "Re-Transcribe" : "Transcribe"}
        </Button>
        <p className="inspector-hint">whisper.cpp · Core ML · Apple Silicon · runs locally</p>
      </div>
      {hasTranscript && (
        <div className="inspector-section">
          <p className="inspector-section-label">Next step</p>
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setWorkspaceMode("edit")}
          >
            <ArrowRight className="h-4 w-4" />
            Switch to Edit mode
          </Button>
          <p className="inspector-hint">Edit the video by editing the text.</p>
        </div>
      )}
    </div>
  );
}
```

`src/components/editor/sidebar/panels/EditToolsPanel.tsx`:

```tsx
import { Toolbox } from "@/components/Toolbox/Toolbox";
import { useEditorUiStore } from "@/stores/editorUiStore";

export function EditToolsPanel() {
  const setFindOpen = useEditorUiStore((s) => s.setFindOpen);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Edit Tools</p>
        <Toolbox onFindClick={() => setFindOpen(true)} />
      </div>
    </div>
  );
}
```

`src/components/editor/sidebar/panels/MusicPanel.tsx`:

```tsx
import { Music } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MusicPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Music</p>
        <Button
          variant="outline"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:music"))}
        >
          <Music className="h-4 w-4" />
          Manage music tracks
        </Button>
        <p className="inspector-hint">Audio beds mixed under the main timeline.</p>
      </div>
    </div>
  );
}
```

`src/components/editor/sidebar/panels/ExportPanel.tsx`:

```tsx
import { Captions, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { totalDuration } from "@/lib/edl";
import { formatDuration } from "@/lib/timecode";
import { useProjectStore } from "@/stores/projectStore";

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const hasContent = Object.keys(project.media).length > 0 && project.segments.length > 0;
  const duration = totalDuration(project);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Export</p>
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
        {hasContent && (
          <div className="inspector-row">
            <span className="inspector-row-label">Duration</span>
            <span className="inspector-row-value">{formatDuration(duration)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the registry**

`src/components/editor/sidebar/registry.tsx`:

```tsx
import { Clapperboard, MicVocal, Music, Scissors, Upload, type LucideIcon } from "lucide-react";
import type React from "react";
import type { WorkspaceMode } from "@/stores/editorUiStore";
import { EditToolsPanel } from "./panels/EditToolsPanel";
import { ExportPanel } from "./panels/ExportPanel";
import { MediaPanel } from "./panels/MediaPanel";
import { MusicPanel } from "./panels/MusicPanel";
import { TranscribePanel } from "./panels/TranscribePanel";

export interface PanelDef {
  id: string;
  icon: LucideIcon;
  label: string;
  modes: WorkspaceMode[];
  component: React.FC;
}

/**
 * Declarative panel registry. Adding a future panel is one entry here plus a
 * component file — the rail and inspector render whatever this list says for
 * the current workspace mode.
 */
export const PANELS: PanelDef[] = [
  { id: "media", icon: Clapperboard, label: "Media", modes: ["transcribe"], component: MediaPanel },
  {
    id: "transcribe",
    icon: MicVocal,
    label: "Transcribe",
    modes: ["transcribe"],
    component: TranscribePanel,
  },
  {
    id: "edit-tools",
    icon: Scissors,
    label: "Edit Tools",
    modes: ["edit"],
    component: EditToolsPanel,
  },
  { id: "music", icon: Music, label: "Music", modes: ["edit"], component: MusicPanel },
  { id: "export", icon: Upload, label: "Export", modes: ["edit"], component: ExportPanel },
];

export function panelsForMode(mode: WorkspaceMode): PanelDef[] {
  return PANELS.filter((p) => p.modes.includes(mode));
}
```

- [ ] **Step 5: Run the registry test**

Run: `npx vitest run tests/panelRegistry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/sidebar tests/panelRegistry.test.ts
git commit -m "feat: add mode-aware panel registry with focused sidebar panels"
```

---

### Task 3: Left sidebar components, CSS, and layout flip

**Files:**
- Create: `src/components/editor/sidebar/EditorSidebar.tsx`, `src/components/editor/sidebar/ToolRail.tsx`, `src/components/editor/sidebar/InspectorPanel.tsx`
- Delete: `src/components/editor/right-sidebar/` (all four files)
- Modify: `src/styles/globals.css` (~lines 975-1076), `src/components/editor/EditorLayout.tsx`

- [ ] **Step 1: Create the three sidebar components**

`src/components/editor/sidebar/ToolRail.tsx`:

```tsx
import { useEditorUiStore } from "@/stores/editorUiStore";
import { panelsForMode } from "./registry";

export function ToolRail() {
  const mode = useEditorUiStore((s) => s.workspaceMode);
  const activePanel = useEditorUiStore((s) => s.activePanel);
  const setActivePanel = useEditorUiStore((s) => s.setActivePanel);

  return (
    <div className="tool-rail" role="toolbar" aria-label="Editor tools">
      {panelsForMode(mode).map((p) => {
        const Icon = p.icon;
        const active = p.id === activePanel;
        return (
          <button
            key={p.id}
            type="button"
            className={`tool-rail-btn${active ? " is-active" : ""}`}
            title={p.label}
            aria-label={p.label}
            aria-pressed={active}
            onClick={() => setActivePanel(p.id)}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
}
```

`src/components/editor/sidebar/InspectorPanel.tsx`:

```tsx
import { useEditorUiStore } from "@/stores/editorUiStore";
import { panelsForMode } from "./registry";

export function InspectorPanel() {
  const mode = useEditorUiStore((s) => s.workspaceMode);
  const activePanel = useEditorUiStore((s) => s.activePanel);
  const open = useEditorUiStore((s) => s.inspectorOpen);

  if (!open) return null;
  const panels = panelsForMode(mode);
  const def = panels.find((p) => p.id === activePanel) ?? panels[0];
  if (!def) return null;
  const Panel = def.component;

  return (
    <div className="inspector-panel" style={{ width: 320 }}>
      <div className="inspector-panel-header">
        <span className="inspector-panel-title">{def.label}</span>
      </div>
      <div className="inspector-panel-scroll">
        <Panel />
      </div>
    </div>
  );
}
```

`src/components/editor/sidebar/EditorSidebar.tsx`:

```tsx
import { InspectorPanel } from "./InspectorPanel";
import { ToolRail } from "./ToolRail";

export function EditorSidebar() {
  return (
    <div className="editor-sidebar">
      <ToolRail />
      <InspectorPanel />
    </div>
  );
}
```

- [ ] **Step 2: Rename + flip the CSS**

In `src/styles/globals.css` (block starting ~line 975):

- Rename class selectors: `.right-editor-sidebar` → `.editor-sidebar`, `.right-tool-rail` → `.tool-rail`, `.right-tool-rail-btn` → `.tool-rail-btn` (including the `::-webkit-scrollbar`, `:hover`, `:focus-visible`, `.is-active`, `.is-active::before` variants), `.right-inspector-panel` → `.inspector-panel`.
- Flip the sidebar to the left edge: in the renamed `.editor-sidebar` and `.inspector-panel` rules, swap any `border-left` ↔ `border-right` declarations (the sidebar's outer border must now sit on its RIGHT edge, facing the content). In `.tool-rail-btn.is-active::before` (the active-indicator bar), swap `left:` ↔ `right:` if it pins to one edge.
- Read the actual block before editing — apply the swaps to whatever left/right properties are present rather than assuming this exact list.

- [ ] **Step 3: Update `EditorLayout.tsx` to put the sidebar on the left**

In `src/components/editor/EditorLayout.tsx`:

1. Replace the import `import { RightEditorSidebar } from "./right-sidebar/RightEditorSidebar";` with `import { EditorSidebar } from "./sidebar/EditorSidebar";`.
2. Move the sidebar element from the END of the flex row to the START — inside `<div className="flex flex-1 overflow-hidden">`, render `<EditorSidebar />` as the FIRST child and delete `<RightEditorSidebar />` from the end.
3. Update the two welcome-screen copy strings (lines ~128-142): `"right panel"` → `"left panel"`; the media hint becomes: `Use the <span…>Media</span> panel on the left, or the Project menu, to open a video file`.

- [ ] **Step 4: Delete the old right-sidebar directory**

```bash
git rm -r src/components/editor/right-sidebar
```

- [ ] **Step 5: Verify nothing references the old names**

Run: `grep -rn "right-sidebar\|RightEditorSidebar\|RightToolRail\|RightInspectorPanel\|activeRightPanel\|right-tool-rail\|right-inspector-panel\|right-editor-sidebar" src/`
Expected: no matches.

- [ ] **Step 6: Full check + tests**

Run: `npm run check && npm test`
Expected: PASS, zero warnings. Then launch `npm run tauri:dev` briefly: sidebar renders on the LEFT with 2 rail icons in transcribe-mode default? — no: initial mode is `edit`, so 3 icons (Edit Tools, Music, Export). Clicking the active icon collapses the panel; clicking again reopens.

- [ ] **Step 7: Commit**

```bash
git add -A src/components/editor src/styles/globals.css
git commit -m "feat: move editor sidebar to the left with mode-aware tool rail"
```

---

### Task 4: Mode-aware transcript (read-only in Transcribe mode) + auto-switching

**Files:**
- Modify: `src/components/TranscriptEditor/TranscriptEditor.tsx` (add `readOnly` prop)
- Modify: `src/components/editor/EditorLayout.tsx` (pass prop; auto-mode effects)

- [ ] **Step 1: Add `readOnly` to TranscriptEditor**

In `src/components/TranscriptEditor/TranscriptEditor.tsx`:

1. Add `readOnly?: boolean;` to the component's props interface (alongside `findOpen` / `onFindOpen` / `onFindClose`).
2. Locate the TipTap `useEditor(...)` call — the returned instance is typically named `editor`. After it, add:

```tsx
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
```

(Adapt the variable name to what the file actually uses; add `readOnly = false` to the destructured props.)

- [ ] **Step 2: Wire mode into EditorLayout**

In `src/components/editor/EditorLayout.tsx`:

```tsx
import { useEditorUiStore } from "@/stores/editorUiStore"; // already imported
```

Inside the component add:

```tsx
  const workspaceMode = useEditorUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useEditorUiStore((s) => s.setWorkspaceMode);

  // Importing media with no transcript lands the user in Transcribe mode —
  // the only useful next step is running transcription.
  useEffect(() => {
    if (hasMedia && !hasTranscript) setWorkspaceMode("transcribe");
  }, [hasMedia, hasTranscript, setWorkspaceMode]);
```

And pass the prop: `<TranscriptEditor readOnly={workspaceMode === "transcribe"} findOpen={…} … />`.

- [ ] **Step 3: Nudge to Edit mode after transcription**

Still in `EditorLayout.tsx`, add a one-shot nudge when a transcript first appears while in transcribe mode:

```tsx
  const prevHasTranscript = useRef(hasTranscript);
  useEffect(() => {
    if (!prevHasTranscript.current && hasTranscript && workspaceMode === "transcribe") {
      useUIStore.getState().pushToast({
        title: "Transcription ready",
        description: "Switch to Edit mode (top bar) to start cutting by text.",
      });
    }
    prevHasTranscript.current = hasTranscript;
  }, [hasTranscript, workspaceMode]);
```

(Add `import { useUIStore } from "@/stores/uiStore";` — the TranscribePanel's "Switch to Edit mode" button is the one-click path.)

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: PASS. In `npm run tauri:dev`: import a video → app lands in Transcribe mode, transcript area (once transcribed) is read-only in Transcribe mode and editable after switching to Edit.

- [ ] **Step 5: Commit**

```bash
git add src/components/TranscriptEditor/TranscriptEditor.tsx src/components/editor/EditorLayout.tsx
git commit -m "feat: read-only transcript in transcribe mode with auto mode switching"
```

---

### Task 5: TopBar — Project menu, mode toggle, recents

**Files:**
- Create: `src/lib/recentProjects.ts`
- Test: `tests/recentProjects.test.ts`
- Modify: `src/components/editor/TopBar.tsx` (full rewrite below)
- Modify: `src/components/Toolbar/Toolbar.tsx` (open-at-path event + recents recording)

**Interfaces:**
- Produces:
  - `getRecentProjects(): string[]`, `addRecentProject(path: string): void` (localStorage key `yusafcut.recentProjects`, max 5, most-recent first, deduped)
  - New window event `"yusafcut:open-project-path"` with `detail: { path: string }` — handled by Toolbar.

- [ ] **Step 1: Write failing recents tests**

Create `tests/recentProjects.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRecentProject, getRecentProjects } from "@/lib/recentProjects";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("recentProjects", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("returns empty list when nothing stored", () => {
    expect(getRecentProjects()).toEqual([]);
  });

  it("adds most-recent first and dedupes", () => {
    addRecentProject("/a.scribe");
    addRecentProject("/b.scribe");
    addRecentProject("/a.scribe");
    expect(getRecentProjects()).toEqual(["/a.scribe", "/b.scribe"]);
  });

  it("caps the list at 5 entries", () => {
    for (const p of ["/1", "/2", "/3", "/4", "/5", "/6"]) addRecentProject(p);
    expect(getRecentProjects()).toEqual(["/6", "/5", "/4", "/3", "/2"]);
  });

  it("survives corrupted storage", () => {
    localStorage.setItem("yusafcut.recentProjects", "{not json");
    expect(getRecentProjects()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npx vitest run tests/recentProjects.test.ts` → FAIL (module missing).

Create `src/lib/recentProjects.ts`:

```ts
/** Recently-opened .scribe project paths, most-recent first (localStorage). */

const KEY = "yusafcut.recentProjects";
const MAX = 5;

export function getRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentProject(path: string): void {
  const list = [path, ...getRecentProjects().filter((p) => p !== path)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — recents are a convenience, not a requirement */
  }
}
```

Run: `npx vitest run tests/recentProjects.test.ts` → PASS (4 tests).

- [ ] **Step 3: Toolbar — open-at-path handler and recents recording**

In `src/components/Toolbar/Toolbar.tsx`:

1. Add import: `import { addRecentProject } from "@/lib/recentProjects";`
2. Extract the body of `handleOpenProject` (lines ~268-290) so both the dialog path and a direct path share it:

```ts
  const openProjectAtPath = useCallback(
    async (path: string) => {
      setMediaLoading(true);
      try {
        const loaded = await loadProject(path);
        cacheProjectTranscripts(loaded);
        replaceProjectBaseline(loaded, { dirty: false, filePath: path });
        resetPlayer();
        addRecentProject(path);
        pushToast({ title: "Project opened", description: path });
      } catch (err) {
        pushToast({
          title: "Failed to open project",
          description: String(err),
          variant: "destructive",
        });
      } finally {
        setMediaLoading(false);
      }
    },
    [setMediaLoading, pushToast, resetPlayer],
  );

  const handleOpenProject = useCallback(async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "YusafCut project", extensions: ["scribe"] }],
    });
    if (typeof path !== "string") return;
    await openProjectAtPath(path);
  }, [openProjectAtPath]);
```

3. In `handleSave` (~line 645), after `markSaved(path);` add `addRecentProject(path);`.
4. In the `useEffect` that wires all `yusafcut:*` listeners (~line 780), add:

```ts
    const onOpenProjectPath = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path) void openProjectAtPath(path);
    };
    window.addEventListener("yusafcut:open-project-path", onOpenProjectPath);
```

…and the matching `removeEventListener` in the cleanup, plus `openProjectAtPath` in the effect's dependency array.

- [ ] **Step 4: Rewrite TopBar**

Replace `src/components/editor/TopBar.tsx` with:

```tsx
import { useCallback, useState } from "react";
import {
  FilePlus2,
  FolderOpen,
  History,
  Menu,
  Power,
  Redo2,
  Save,
  Scissors,
  Undo2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getRecentProjects } from "@/lib/recentProjects";
import { useEditorUiStore, type WorkspaceMode } from "@/stores/editorUiStore";
import { useProjectStore, useTemporalProjectStore } from "@/stores/projectStore";

function dispatch(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));
}

export function TopBar() {
  const filePath = useProjectStore((s) => s.filePath);
  const dirty = useProjectStore((s) => s.dirty);
  const project = useProjectStore((s) => s.project);
  const canUndo = useTemporalProjectStore((s) => s.pastStates.length > 0);
  const canRedo = useTemporalProjectStore((s) => s.futureStates.length > 0);
  const workspaceMode = useEditorUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useEditorUiStore((s) => s.setWorkspaceMode);
  const [recents, setRecents] = useState<string[]>([]);

  const displayName = filePath?.split(/[\\/]/).pop() ?? `${project.name}.scribe`;

  const handleUndo = useCallback(() => {
    useProjectStore.temporal.getState().undo();
  }, []);
  const handleRedo = useCallback(() => {
    useProjectStore.temporal.getState().redo();
  }, []);

  const modes: Array<{ id: WorkspaceMode; label: string }> = [
    { id: "transcribe", label: "Transcribe" },
    { id: "edit", label: "Edit" },
  ];

  return (
    <div className="editor-topbar">
      <div className="editor-topbar-title">
        <DropdownMenu onOpenChange={(open) => open && setRecents(getRecentProjects())}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="tool-button" title="Project menu">
              <Menu className="h-4 w-4" />
              Project
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuItem onClick={() => dispatch("yusafcut:new-project")}>
              <FilePlus2 className="h-4 w-4 mr-2" />
              New project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => dispatch("yusafcut:open-project")}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Open project…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => dispatch("yusafcut:open")}>
              <Video className="h-4 w-4 mr-2" />
              Open video file…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => dispatch("yusafcut:add-clip")}>
              <Scissors className="h-4 w-4 mr-2" />
              Add clip…
            </DropdownMenuItem>
            {recents.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Recent projects</DropdownMenuLabel>
                {recents.map((path) => (
                  <DropdownMenuItem
                    key={path}
                    onClick={() => dispatch("yusafcut:open-project-path", { path })}
                  >
                    <History className="h-4 w-4 mr-2" />
                    <span className="truncate">{path.split(/[\\/]/).pop()}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => dispatch("yusafcut:snapshots")}>
              <History className="h-4 w-4 mr-2" />
              Snapshots…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => dispatch("yusafcut:close-project")}
            >
              <Power className="h-4 w-4 mr-2" />
              Close project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="editor-topbar-name">{displayName}</span>
        {dirty && <span className="editor-topbar-dirty">·</span>}
      </div>

      <div className="editor-topbar-modes" role="tablist" aria-label="Workspace mode">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={workspaceMode === m.id}
            className={`mode-toggle-btn${workspaceMode === m.id ? " is-active" : ""}`}
            onClick={() => setWorkspaceMode(m.id)}
          >
            {m.label}
          </button>
        ))}
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
          variant={dirty ? "default" : "ghost"}
          className="tool-button"
          onClick={() => dispatch("yusafcut:save")}
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

Add the mode-toggle CSS to `src/styles/globals.css` next to the `.editor-topbar` rules:

```css
.editor-topbar-modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.5);
}

.mode-toggle-btn {
  padding: 3px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  transition: background 120ms ease, color 120ms ease;
}

.mode-toggle-btn:hover {
  color: hsl(var(--foreground));
}

.mode-toggle-btn.is-active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
}
```

(If `.editor-topbar` uses `justify-content: space-between` with two children, verify the three-child layout still centers the toggle — if not, set `.editor-topbar { display: flex; align-items: center; justify-content: space-between; }` and give `.editor-topbar-title` and `.editor-topbar-actions` `flex: 1` with the actions right-aligned via `justify-content: flex-end`.)

- [ ] **Step 5: Verify**

Run: `npm run check && npm test`
Expected: PASS. In `npm run tauri:dev`: Project menu opens with all items working (New/Open/Open video/Add clip/Snapshots/Close, recents appear after a save/open); mode toggle switches rail contents; Save button highlights when dirty.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recentProjects.ts tests/recentProjects.test.ts \
  src/components/editor/TopBar.tsx src/components/Toolbar/Toolbar.tsx src/styles/globals.css
git commit -m "feat: add project menu, workspace mode toggle, and recent projects to top bar"
```

---

### Task 6: Manual smoke test (non-regression sweep)

- [ ] **Step 1: Run the app and sweep every relocated action**

`npm run tauri:dev`, then verify each v4.4.0 action is reachable and works:

| Action | New home |
|---|---|
| Open video / Open project / New / Close / Add clip / Snapshots | TopBar Project menu |
| Record / Music tracks / Add clip | Media panel (Transcribe mode) |
| Transcribe / Re-Transcribe | Transcribe panel |
| Markers, Edit ops (silences/fillers/pauses), Zoom, Find, Select | Edit Tools panel (Edit mode) |
| Music tracks | Music panel (Edit mode) |
| Export .mp4 / Export captions | Export panel (Edit mode) |
| Save / Undo / Redo | TopBar (unchanged) |

Also verify: video keeps playing across a mode switch (single `<video>` invariant); keyboard shortcuts (Space/J/K/L, ⌘Z, ⌘S, I/O) unchanged.

- [ ] **Step 2: Fix anything broken before proceeding** (report deviations in the task summary).

---

### Task 7: Version bump, changelog, docs

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (→ `4.6.0`)
- Modify: `CHANGELOG.md`, `docs/architecture.md`, `README.md` (if the feature table mentions toolbar/sidebar), `docs/yusafcut-spec.md` (UI-layout sections)

- [ ] **Step 1: Bump the three version fields to 4.6.0**

- [ ] **Step 2: CHANGELOG entry** (new section above `[4.5.0]`, below `[Unreleased]`):

```markdown
## [4.6.0] — <today's date>

### Added
- **Workspace modes** — a `Transcribe | Edit` toggle in the top bar. Transcribe mode focuses on getting the text right (Media, Transcribe panels; transcript read-only); Edit mode focuses on cutting (Edit Tools, Music, Export panels).
- **Project menu in the top bar** — New/Open project, Open video, Add clip, Recent projects (last 5), Snapshots, Close project.
- **Panel registry** — sidebar panels are declared in one registry (`sidebar/registry.tsx`); adding a panel is one entry + one component file.
- Recent projects list (`src/lib/recentProjects.ts`, localStorage-backed).

### Changed
- **Sidebar moved to the left** with the icon rail restored; the v4.4.0 right sidebar components were replaced by `components/editor/sidebar/`.
- The combined inspector panel was split into focused panels: Media, Transcribe, Edit Tools, Music, Export.
- Project lifecycle actions moved out of the sidebar into the top bar; Save is a prominent top-bar button.
- Importing media with no transcript now lands in Transcribe mode automatically; a toast nudges to Edit mode after transcription.
```

- [ ] **Step 3: Update `docs/architecture.md` "UI layout" section**

Replace the v4.4.0 layout description with: TopBar (Project menu · mode toggle · Undo/Redo/Save), left `EditorSidebar` (`ToolRail` + `InspectorPanel`, panels from `sidebar/registry.tsx` filtered by `editorUiStore.workspaceMode`), transcript centre, preview right, BottomTimeline, StatusBar. Update the store list line for `editorUiStore` (workspaceMode, activePanel). Update `docs/yusafcut-spec.md` sections describing the toolbar/right-sidebar to match, and `README.md` if it mentions the layout.

- [ ] **Step 4: Full verification**

Run: `npm run ci`
Expected: check + JS tests + Rust tests + sidecar tests all PASS.

- [ ] **Step 5: Commit and push**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json CHANGELOG.md docs/architecture.md docs/yusafcut-spec.md README.md
git commit -m "chore: bump to 4.6.0; document left sidebar and workspace modes"
git push -u origin feature/left-sidebar-modes
```

**Do NOT create a PR or merge** — Awais does that manually.
