import { FilePlus2, FolderOpen, History, Music, Power, Radio, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/projectStore";

export function MediaPanel() {
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Import</p>
        <Button
          variant="outline"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:open"))}
        >
          <FolderOpen className="h-4 w-4" />
          Open video file
        </Button>
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
      <div className="inspector-divider" />
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
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Project</p>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:new-project"))}
        >
          <FilePlus2 className="h-4 w-4" />
          New project
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:open-project"))}
        >
          <FolderOpen className="h-4 w-4" />
          Open project
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:snapshots"))}
        >
          <History className="h-4 w-4" />
          Snapshots
        </Button>
        <Button
          variant="ghost"
          className="w-full gap-2 justify-start text-destructive hover:text-destructive"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:close-project"))}
        >
          <Power className="h-4 w-4" />
          Close project
        </Button>
      </div>
    </div>
  );
}
