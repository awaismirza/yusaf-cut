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
