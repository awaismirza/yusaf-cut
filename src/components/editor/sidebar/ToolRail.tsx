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
