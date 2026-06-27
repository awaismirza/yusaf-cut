import { Captions, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/projectStore";
import { totalDuration } from "@/lib/edl";
import { formatDuration } from "@/lib/timecode";

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const duration = totalDuration(project);
  const hasContent =
    Object.keys(project.media).length > 0 && project.segments.length > 0;

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Render</p>
        <Button
          className="w-full gap-2"
          disabled={!hasContent}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:export"))}
        >
          <Upload className="h-4 w-4" />
          Export .mp4
        </Button>
        <Button
          variant="outline"
          className="w-full gap-2"
          disabled={!hasContent}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:export-captions"))}
        >
          <Captions className="h-4 w-4" />
          Export captions
        </Button>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Output info</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Duration</span>
          <span className="inspector-row-value">{formatDuration(duration)}</span>
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Format</p>
        <div className="inspector-segmented">
          {["MP4 H.264", "HEVC", "Audio only"].map((f) => (
            <button key={f} className="inspector-segmented-btn" disabled>
              {f}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Format and quality selection coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Quality</p>
        <div className="inspector-segmented">
          {["Draft", "Standard", "High"].map((q) => (
            <button key={q} className="inspector-segmented-btn" disabled>
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
