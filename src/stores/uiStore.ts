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
   * True while a heavy transcript/EDL edit is being applied. The whole app
   * shows a blocking "Updating timeline…" overlay and playback is locked so
   * the user can't start playback against a half-rebuilt timeline.
   */
  isProcessingEdit: boolean;
  /** Label shown in the processing overlay, e.g. "Updating timeline…". */
  processingEditLabel: string | null;
  activeTool: EditorTool;

  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  setExportingProgress: (p: number | null) => void;
  setModelDownloadProgress: (p: number | null) => void;
  setModelDownloadLabel: (label: string | null) => void;
  setTranscribeProgress: (p: number | null) => void;
  setMediaLoading: (loading: boolean) => void;
  beginProcessingEdit: (label: string) => void;
  endProcessingEdit: () => void;
  /**
   * Run a heavy edit while the processing overlay is shown and playback is
   * locked. Yields one animation frame first so the overlay can paint before a
   * synchronous edit blocks the main thread, and always clears the busy state
   * in `finally` so it can never get stuck on.
   */
  withProcessingEdit: <T>(label: string, fn: () => Promise<T> | T) => Promise<T>;
  setActiveTool: (tool: EditorTool) => void;
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  exportingProgress: null,
  modelDownloadProgress: null,
  modelDownloadLabel: null,
  transcribeProgress: null,
  mediaLoading: false,
  isProcessingEdit: false,
  processingEditLabel: null,
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
  beginProcessingEdit: (label) => set({ isProcessingEdit: true, processingEditLabel: label }),
  endProcessingEdit: () => set({ isProcessingEdit: false, processingEditLabel: null }),
  withProcessingEdit: async (label, fn) => {
    set({ isProcessingEdit: true, processingEditLabel: label });
    // Yield one frame so the overlay paints before a heavy synchronous edit
    // blocks the main thread.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      return await fn();
    } finally {
      set({ isProcessingEdit: false, processingEditLabel: null });
    }
  },
  setActiveTool: (tool) => set({ activeTool: tool }),
}));
