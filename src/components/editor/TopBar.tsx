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
