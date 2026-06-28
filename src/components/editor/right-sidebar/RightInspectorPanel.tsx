import { useEditorUiStore } from "@/stores/editorUiStore";
import { CombinedPanel } from "./panels/CombinedPanel";

export function RightInspectorPanel() {
  const inspectorOpen = useEditorUiStore((s) => s.inspectorOpen);

  return (
    <div
      className="right-inspector-panel"
      style={{ width: inspectorOpen ? 320 : 0 }}
      aria-hidden={!inspectorOpen}
    >
      {inspectorOpen && (
        <>
          <div className="inspector-panel-header">
            <span className="inspector-panel-title">Tools</span>
          </div>
          <div className="inspector-panel-scroll">
            <CombinedPanel />
          </div>
        </>
      )}
    </div>
  );
}
