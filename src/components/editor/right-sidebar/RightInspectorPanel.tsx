import { CombinedPanel } from "./panels/CombinedPanel";

export function RightInspectorPanel() {
  return (
    <div className="right-inspector-panel" style={{ width: 320 }}>
      <div className="inspector-panel-header">
        <span className="inspector-panel-title">Tools</span>
      </div>
      <div className="inspector-panel-scroll">
        <CombinedPanel />
      </div>
    </div>
  );
}
