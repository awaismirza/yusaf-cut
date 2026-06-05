/** Lightweight UI store: toasts, modal state, model-download progress overlay. */

import { create } from "zustand";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};

export type EditorTool = "select";

interface UIState {
  toasts: Toast[];
  exportingProgress: number | null;
  modelDownloadProgress: number | null;
  /** Human-readable label for the current download phase, e.g. "Downloading Core ML encoder" */
  modelDownloadLabel: string | null;
  transcribeProgress: number | null;
  mediaLoading: boolean;
  /**
   * When non-null, an indeterminate "operation in progress" dialog is shown
   * with this label, blocking the UI until the operation completes.
   * Used for heavy synchronous operations like Trim Silences.
   */
  editOperationLabel: string | null;
  activeTool: EditorTool;

  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  setExportingProgress: (p: number | null) => void;
  setModelDownloadProgress: (p: number | null) => void;
  setModelDownloadLabel: (label: string | null) => void;
  setTranscribeProgress: (p: number | null) => void;
  setMediaLoading: (loading: boolean) => void;
  setEditOperationLabel: (label: string | null) => void;
  setActiveTool: (tool: EditorTool) => void;
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  exportingProgress: null,
  modelDownloadProgress: null,
  modelDownloadLabel: null,
  transcribeProgress: null,
  mediaLoading: false,
  editOperationLabel: null,
  activeTool: "select",

  pushToast: (t) =>
    set((s) => ({
      toasts: [...s.toasts, { id: crypto.randomUUID(), ...t }],
    })),
  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),

  setExportingProgress: (p) => set({ exportingProgress: p }),
  setModelDownloadProgress: (p) => set({ modelDownloadProgress: p }),
  setModelDownloadLabel: (label) => set({ modelDownloadLabel: label }),
  setTranscribeProgress: (p) => set({ transcribeProgress: p }),
  setMediaLoading: (loading) => set({ mediaLoading: loading }),
  setEditOperationLabel: (label) => set({ editOperationLabel: label }),
  setActiveTool: (tool) => set({ activeTool: tool }),
}));
