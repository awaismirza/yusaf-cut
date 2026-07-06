import { Music, Radio, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/projectStore";

export function MediaPanel() {
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Import</p>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          disabled={!hasMedia}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:add-clip"))}
        >
          <Scissors className="h-4 w-4" />
          Add clip
        </Button>
      </div>
      <div className="inspector-section">
        <p className="inspector-section-label">Capture</p>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:record"))}
        >
          <Radio className="h-4 w-4" />
          Record
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:music"))}
        >
          <Music className="h-4 w-4" />
          Music tracks
        </Button>
      </div>
      <p className="inspector-hint">
        Open a video or project from the Project menu in the top bar.
      </p>
    </div>
  );
}
