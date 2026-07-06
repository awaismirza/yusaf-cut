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
