import { useEditorUiStore, type RightEditorPanel } from "@/stores/editorUiStore";
import { LayoutPanel } from "./panels/LayoutPanel";
import { BackgroundPanel } from "./panels/BackgroundPanel";
import { ScreenPanel } from "./panels/ScreenPanel";
import { CropPanel } from "./panels/CropPanel";
import { AnnotatePanel } from "./panels/AnnotatePanel";
import { MaskPanel } from "./panels/MaskPanel";
import { TranscriptPanel } from "./panels/TranscriptPanel";
import { CaptionsPanel } from "./panels/CaptionsPanel";
import { AiPanel } from "./panels/AiPanel";
import { MediaPanel } from "./panels/MediaPanel";
import { ExportPanel } from "./panels/ExportPanel";
import { SettingsPanel } from "./panels/SettingsPanel";

const PANEL_COMPONENTS: Record<RightEditorPanel, React.FC> = {
  layout: LayoutPanel,
  background: BackgroundPanel,
  screen: ScreenPanel,
  crop: CropPanel,
  annotate: AnnotatePanel,
  mask: MaskPanel,
  transcript: TranscriptPanel,
  captions: CaptionsPanel,
  ai: AiPanel,
  media: MediaPanel,
  export: ExportPanel,
  settings: SettingsPanel,
};

const PANEL_LABELS: Record<RightEditorPanel, string> = {
  layout: "Layout",
  background: "Background",
  screen: "Screen",
  crop: "Crop",
  annotate: "Annotate",
  mask: "Mask",
  transcript: "Transcript",
  captions: "Captions",
  ai: "AI",
  media: "Media",
  export: "Export",
  settings: "Settings",
};

export function RightInspectorPanel() {
  const activeRightPanel = useEditorUiStore((s) => s.activeRightPanel);
  const inspectorOpen = useEditorUiStore((s) => s.inspectorOpen);

  const PanelComponent = PANEL_COMPONENTS[activeRightPanel];

  return (
    <div
      className="right-inspector-panel"
      style={{ width: inspectorOpen ? 320 : 0 }}
      aria-hidden={!inspectorOpen}
    >
      {inspectorOpen && (
        <>
          <div className="inspector-panel-header">
            <span className="inspector-panel-title">{PANEL_LABELS[activeRightPanel]}</span>
          </div>
          <div className="inspector-panel-scroll">
            <PanelComponent />
          </div>
        </>
      )}
    </div>
  );
}
