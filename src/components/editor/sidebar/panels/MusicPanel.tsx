import { Music } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MusicPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Music</p>
        <Button
          variant="outline"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:music"))}
        >
          <Music className="h-4 w-4" />
          Manage music tracks
        </Button>
        <p className="inspector-hint">Audio beds mixed under the main timeline.</p>
      </div>
    </div>
  );
}
