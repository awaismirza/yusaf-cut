import { useEffect, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { PreviewWorkspace } from "./PreviewWorkspace";
import { BottomTimeline } from "./BottomTimeline";
import { EditorSidebar } from "./sidebar/EditorSidebar";
import { TranscriptEditor } from "@/components/TranscriptEditor/TranscriptEditor";
import { StatusBar } from "@/components/StatusBar/StatusBar";
import { Toolbar } from "@/components/Toolbar/Toolbar";
import { useProjectStore } from "@/stores/projectStore";
import { useEditorUiStore } from "@/stores/editorUiStore";
import { useUIStore } from "@/stores/uiStore";

const MIN_VIDEO_WIDTH = 360;
const MAX_VIDEO_WIDTH = 1100;
const DEFAULT_VIDEO_WIDTH = 560;
const STORAGE_KEY = "yusafcut.videoPanelWidth";

export function EditorLayout() {
  const hasTranscript = useProjectStore((s) =>
    s.project.segments.some((seg) => seg.words.length > 0),
  );
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);

  const findOpen = useEditorUiStore((s) => s.findOpen);
  const setFindOpen = useEditorUiStore((s) => s.setFindOpen);
  const workspaceMode = useEditorUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useEditorUiStore((s) => s.setWorkspaceMode);

  // Importing media with no transcript lands the user in Transcribe mode —
  // the only useful next step is running transcription.
  useEffect(() => {
    if (hasMedia && !hasTranscript) setWorkspaceMode("transcribe");
  }, [hasMedia, hasTranscript, setWorkspaceMode]);

  // One-shot nudge when a transcript first appears while in Transcribe mode.
  // The Transcribe panel's "Switch to Edit mode" button is the one-click path.
  const prevHasTranscript = useRef(hasTranscript);
  useEffect(() => {
    if (!prevHasTranscript.current && hasTranscript && workspaceMode === "transcribe") {
      useUIStore.getState().pushToast({
        title: "Transcription ready",
        description: "Switch to Edit mode (top bar) to start cutting by text.",
      });
    }
    prevHasTranscript.current = hasTranscript;
  }, [hasTranscript, workspaceMode]);

  const [videoWidth, setVideoWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_VIDEO_WIDTH;
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) && parsed >= MIN_VIDEO_WIDTH && parsed <= MAX_VIDEO_WIDTH
      ? parsed
      : DEFAULT_VIDEO_WIDTH;
  });

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, String(videoWidth));
    } catch {
      /* ignore */
    }
  }, [videoWidth]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - e.clientX;
      const next = Math.max(
        MIN_VIDEO_WIDTH,
        Math.min(MAX_VIDEO_WIDTH, dragRef.current.startWidth + delta),
      );
      setVideoWidth(next);
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    dragRef.current = { startX: e.clientX, startWidth: videoWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        <EditorSidebar />

        {hasTranscript && (
          <>
            <main className="relative flex min-w-0 flex-1 overflow-hidden border-r border-border">
              <TranscriptEditor
                readOnly={workspaceMode === "transcribe"}
                findOpen={findOpen}
                onFindOpen={() => setFindOpen(true)}
                onFindClose={() => setFindOpen(false)}
              />
            </main>

            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              onDoubleClick={() => setVideoWidth(DEFAULT_VIDEO_WIDTH)}
              className="group relative w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
              title="Drag to resize · double-click to reset"
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
              <div className="absolute inset-y-1/2 left-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/50 group-hover:bg-foreground/30" />
            </div>
          </>
        )}

        {/*
         * IMPORTANT: keep a single VideoPreview instance across both layout states.
         * We change className/style on this wrapper but never unmount it — unmounting
         * would drop the loaded <video> source and decoded buffers.
         */}
        <div
          className={
            hasTranscript
              ? "contents"
              : "flex flex-1 flex-col items-center justify-center overflow-hidden gap-5 px-8"
          }
        >
          <aside
            className={
              hasTranscript
                ? "flex h-full shrink-0 flex-col overflow-hidden bg-black"
                : "flex w-full max-w-[900px] flex-col overflow-hidden rounded-2xl bg-black shadow-[0_8px_48px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.07]"
            }
            style={hasTranscript ? { width: videoWidth } : { height: "min(560px, 65vh)" }}
          >
            <PreviewWorkspace />
          </aside>

          {!hasTranscript && (
            <p className="text-sm text-muted-foreground/70">
              {hasMedia ? (
                <>
                  Click{" "}
                  <span className="font-semibold text-foreground/80">Transcribe</span> in the
                  left panel to transcribe and start editing
                </>
              ) : (
                <>
                  Use the{" "}
                  <span className="font-semibold text-foreground/80">Media</span> panel on the
                  left, or the Project menu, to open a video file
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {hasMedia && <BottomTimeline />}

      <StatusBar />

      {/* Toolbar renders only its dialogs — no visible chrome */}
      <Toolbar />
    </div>
  );
}
