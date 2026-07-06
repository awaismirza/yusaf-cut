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
