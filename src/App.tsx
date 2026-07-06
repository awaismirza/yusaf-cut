import { useEffect } from "react";
import { EditorLayout } from "@/components/editor/EditorLayout";
import { ProcessingOverlay } from "@/components/ProcessingOverlay";
import { RecorderDialog } from "@/components/Recorder/RecorderDialog";
import { RecordingHUD } from "@/components/Recorder/RecordingHUD";
import { Toaster } from "@/components/ui/toaster";
import { initRecorder } from "@/stores/recordingStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useTranscribeProgress } from "@/hooks/useTranscribeProgress";
import { useProjectStore } from "@/stores/projectStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useUIStore } from "@/stores/uiStore";
import { initJobsStream } from "@/stores/jobsStore";
import { importMedia } from "@/lib/ipc";
import { readTranscriptCache } from "@/lib/transcriptCache";
import { totalDuration } from "@/lib/edl";
import { getCurrentWebview } from "@tauri-apps/api/webview";

const MEDIA_DROP_EXTENSIONS = new Set(["mp4", "mov", "m4v", "mkv", "webm", "m4a", "wav"]);

function isSupportedMediaPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension ? MEDIA_DROP_EXTENSIONS.has(extension) : false;
}

export default function App() {
  useKeyboardShortcuts();
  useAutoSave();
  useTranscribeProgress();

  const pushToast = useUIStore((s) => s.pushToast);
  const setMediaLoading = useUIStore((s) => s.setMediaLoading);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  useEffect(() => {
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void initRecorder().then((d) => {
      if (cancelled) d();
      else dispose = d;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void initJobsStream().then((dispose) => {
      if (cancelled) dispose();
      else unlisten = dispose;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    if (!("__TAURI_INTERNALS__" in window)) return;

    async function addDroppedClip(path: string) {
      if (!isSupportedMediaPath(path)) {
        pushToast({
          title: "Unsupported file",
          description: "Drop an MP4, MOV, MKV, WebM, M4A, or WAV file.",
          variant: "destructive",
        });
        return;
      }
      setMediaLoading(true);
      try {
        const before = useProjectStore.getState().project;
        const appendAt = totalDuration(before);
        const media = await importMedia(path);
        const cachedWords = readTranscriptCache(media) ?? [];
        useProjectStore.getState().addMediaWithTranscript(media, cachedWords);
        usePlayerStore.getState().clearTimelineRange();
        usePlayerStore.getState().setSelectedWordIds(new Set());
        window.dispatchEvent(
          new CustomEvent("yusafcut:seek-output", { detail: { time: appendAt } }),
        );
        pushToast({
          title:
            cachedWords.length > 0
              ? "Dropped clip added with cached transcript"
              : "Dropped clip added",
          description:
            cachedWords.length > 0
              ? media.path
              : "Use the Transcript panel to transcribe this clip.",
        });
      } catch (err) {
        pushToast({
          title: "Failed to add dropped clip",
          description: String(err),
          variant: "destructive",
        });
      } finally {
        setMediaLoading(false);
      }
    }

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const mediaPath = event.payload.paths.find(isSupportedMediaPath) ?? event.payload.paths[0];
        if (mediaPath) void addDroppedClip(mediaPath);
      })
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        // Browser-only preview does not expose Tauri drag/drop events.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [pushToast, setMediaLoading]);

  return (
    <>
      <EditorLayout />
      <RecorderDialog />
      <RecordingHUD />
      <ProcessingOverlay />
      <Toaster />
    </>
  );
}
