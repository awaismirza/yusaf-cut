import { create } from "zustand";

export type RightEditorPanel = "main";

interface EditorUiState {
  activeRightPanel: RightEditorPanel;
  inspectorOpen: boolean;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3";
  previewZoom: number;
  autoZoomEnabled: boolean;
  findOpen: boolean;

  setActiveRightPanel: (panel: RightEditorPanel) => void;
  setAspectRatio: (ar: "16:9" | "9:16" | "1:1" | "4:3") => void;
  setPreviewZoom: (zoom: number) => void;
  setAutoZoomEnabled: (enabled: boolean) => void;
  setFindOpen: (open: boolean) => void;
}

export const useEditorUiStore = create<EditorUiState>((set, get) => ({
  activeRightPanel: "main",
  inspectorOpen: true,
  aspectRatio: "16:9",
  previewZoom: 1,
  autoZoomEnabled: true,
  findOpen: false,

  setActiveRightPanel: (panel) => {
    const { activeRightPanel, inspectorOpen } = get();
    if (panel === activeRightPanel) {
      set({ inspectorOpen: !inspectorOpen });
    } else {
      set({ activeRightPanel: panel, inspectorOpen: true });
    }
  },
  setAspectRatio: (ar) => set({ aspectRatio: ar }),
  setPreviewZoom: (zoom) => set({ previewZoom: zoom }),
  setAutoZoomEnabled: (enabled) => set({ autoZoomEnabled: enabled }),
  setFindOpen: (open) => set({ findOpen: open }),
}));
