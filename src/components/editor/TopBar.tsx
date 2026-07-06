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
import { SHORTCUT_LABELS, useRecordingStore } from "@/stores/recordingStore";

function dispatch(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));
}

const MODES: Array<{ id: WorkspaceMode; label: string }> = [
  { id: "transcribe", label: "Transcribe" },
  { id: "edit", label: "Edit" },
];

export function TopBar() {
  const filePath = useProjectStore((s) => s.filePath);
  const dirty = useProjectStore((s) => s.dirty);
  const project = useProjectStore((s) => s.project);
  const canUndo = useTemporalProjectStore((s) => s.pastStates.length > 0);
  const canRedo = useTemporalProjectStore((s) => s.futureStates.length > 0);
  const workspaceMode = useEditorUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useEditorUiStore((s) => s.setWorkspaceMode);
  const recorderPhase = useRecordingStore((s) => s.phase);
  const openRecorder = useRecordingStore((s) => s.openDialog);
  const [recents, setRecents] = useState<string[]>([]);

  const displayName = filePath?.split(/[\\/]/).pop() ?? `${project.name}.scribe`;

  const handleUndo = useCallback(() => {
    useProjectStore.temporal.getState().undo();
  }, []);
  const handleRedo = useCallback(() => {
    useProjectStore.temporal.getState().redo();
  }, []);

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
        {MODES.map((m) => (
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
        <button
          type="button"
          className={`topbar-record-btn${recorderPhase !== "idle" ? " is-live" : ""}`}
          onClick={openRecorder}
          disabled={recorderPhase !== "idle"}
          title={`Record screen, camera, or voice (${SHORTCUT_LABELS.record})`}
        >
          <span className="recorder-dot is-live" />
          {recorderPhase === "idle" ? "Record" : "Recording…"}
        </button>
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
