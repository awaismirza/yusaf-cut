import { Captions, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { totalDuration } from "@/lib/edl";
import { formatDuration } from "@/lib/timecode";
import { useProjectStore } from "@/stores/projectStore";

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const hasContent = Object.keys(project.media).length > 0 && project.segments.length > 0;
  const duration = totalDuration(project);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Export</p>
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
        {hasContent && (
          <div className="inspector-row">
            <span className="inspector-row-label">Duration</span>
            <span className="inspector-row-value">{formatDuration(duration)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
