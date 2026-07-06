import { create } from "zustand";

export type WorkspaceMode = "transcribe" | "edit";

/**
 * Default panel per mode. Kept here (not in the panel registry) so the store
 * has no component imports — the registry test asserts these ids exist.
 */
export const DEFAULT_PANEL: Record<WorkspaceMode, string> = {
  transcribe: "transcribe",
  edit: "edit-tools",
};

interface EditorUiState {
  workspaceMode: WorkspaceMode;
  activePanel: string;
  inspectorOpen: boolean;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3";
  previewZoom: number;
  autoZoomEnabled: boolean;
  findOpen: boolean;

  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setActivePanel: (panel: string) => void;
  setAspectRatio: (ar: "16:9" | "9:16" | "1:1" | "4:3") => void;
  setPreviewZoom: (zoom: number) => void;
  setAutoZoomEnabled: (enabled: boolean) => void;
  setFindOpen: (open: boolean) => void;
}

export const useEditorUiStore = create<EditorUiState>((set, get) => ({
  workspaceMode: "edit",
  activePanel: DEFAULT_PANEL.edit,
  inspectorOpen: true,
  aspectRatio: "16:9",
  previewZoom: 1,
  autoZoomEnabled: true,
  findOpen: false,

  setWorkspaceMode: (mode) => {
    if (mode === get().workspaceMode) return;
    set({ workspaceMode: mode, activePanel: DEFAULT_PANEL[mode], inspectorOpen: true });
  },
  setActivePanel: (panel) => {
    const { activePanel, inspectorOpen } = get();
    if (panel === activePanel) {
      set({ inspectorOpen: !inspectorOpen });
    } else {
      set({ activePanel: panel, inspectorOpen: true });
    }
  },
  setAspectRatio: (ar) => set({ aspectRatio: ar }),
  setPreviewZoom: (zoom) => set({ previewZoom: zoom }),
  setAutoZoomEnabled: (enabled) => set({ autoZoomEnabled: enabled }),
  setFindOpen: (open) => set({ findOpen: open }),
}));
