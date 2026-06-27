import { useEffect, useRef } from "react";
import { VideoPreview } from "@/components/VideoPreview/VideoPreview";
import { useEditorUiStore } from "@/stores/editorUiStore";

const CANVAS_DIMENSIONS: Record<string, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:3": [1440, 1080],
};

export function PreviewWorkspace() {
  const containerRef = useRef<HTMLDivElement>(null);
  const aspectRatio = useEditorUiStore((s) => s.aspectRatio);
  const autoZoomEnabled = useEditorUiStore((s) => s.autoZoomEnabled);
  const setPreviewZoom = useEditorUiStore((s) => s.setPreviewZoom);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !autoZoomEnabled) return;

    const [canvasW, canvasH] = CANVAS_DIMENSIONS[aspectRatio] ?? [1920, 1080];

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      const zoom = Math.min(width / canvasW, height / canvasH);
      setPreviewZoom(Math.max(0.25, Math.min(2.0, zoom)));
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [aspectRatio, autoZoomEnabled, setPreviewZoom]);

  return (
    <div ref={containerRef} className="preview-workspace">
      <VideoPreview />
    </div>
  );
}
