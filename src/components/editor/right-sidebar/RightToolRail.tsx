import { SlidersHorizontal } from "lucide-react";
import { useEditorUiStore } from "@/stores/editorUiStore";

export function RightToolRail() {
  const activeRightPanel = useEditorUiStore((s) => s.activeRightPanel);
  const setActiveRightPanel = useEditorUiStore((s) => s.setActiveRightPanel);

  const isActive = activeRightPanel === "main";

  return (
    <div className="right-tool-rail" role="toolbar" aria-label="Editor tools">
      <button
        type="button"
        className={`right-tool-rail-btn${isActive ? " is-active" : ""}`}
        title="Tools"
        aria-label="Tools"
        aria-pressed={isActive}
        onClick={() => setActiveRightPanel("main")}
      >
        <SlidersHorizontal className="h-5 w-5" />
      </button>
    </div>
  );
}
