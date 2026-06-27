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
