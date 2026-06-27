import {
  Captions,
  Crop,
  FileText,
  FolderOpen,
  LayoutTemplate,
  Monitor,
  Palette,
  PenTool,
  Scan,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEditorUiStore, type RightEditorPanel } from "@/stores/editorUiStore";

type LucideIcon = React.FC<{ className?: string }>;

const RAIL_ITEMS: { panel: RightEditorPanel; icon: LucideIcon; label: string }[] = [
  { panel: "layout", icon: LayoutTemplate, label: "Layout" },
  { panel: "background", icon: Palette, label: "Background" },
  { panel: "screen", icon: Monitor, label: "Screen" },
  { panel: "crop", icon: Crop, label: "Crop" },
  { panel: "annotate", icon: PenTool, label: "Annotate" },
  { panel: "mask", icon: Scan, label: "Mask" },
  { panel: "transcript", icon: FileText, label: "Transcript" },
  { panel: "captions", icon: Captions, label: "Captions" },
  { panel: "ai", icon: Sparkles, label: "AI" },
  { panel: "media", icon: FolderOpen, label: "Media" },
  { panel: "export", icon: Upload, label: "Export" },
  { panel: "settings", icon: Settings, label: "Settings" },
];

export function RightToolRail() {
  const activeRightPanel = useEditorUiStore((s) => s.activeRightPanel);
  const setActiveRightPanel = useEditorUiStore((s) => s.setActiveRightPanel);

  return (
    <div className="right-tool-rail" role="toolbar" aria-label="Editor tools">
      {RAIL_ITEMS.map(({ panel, icon: Icon, label }) => {
        const isActive = activeRightPanel === panel;
        return (
          <button
            key={panel}
            type="button"
            className={`right-tool-rail-btn${isActive ? " is-active" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => setActiveRightPanel(panel)}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
}
