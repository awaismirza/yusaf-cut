import {
  Captions,
  FilePlus2,
  FolderOpen,
  History,
  MicVocal,
  Music,
  Power,
  Radio,
  Scissors,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toolbox } from "@/components/Toolbox/Toolbox";
import { useProjectStore } from "@/stores/projectStore";
import { useEditorUiStore } from "@/stores/editorUiStore";
import { totalDuration } from "@/lib/edl";
import { formatDuration } from "@/lib/timecode";

export function CombinedPanel() {
  const project = useProjectStore((s) => s.project);
  const hasTranscript = project.segments.some((seg) => seg.words.length > 0);
  const hasMedia = Object.keys(project.media).length > 0;
  const hasContent = hasMedia && project.segments.length > 0;
  const duration = totalDuration(project);
  const setFindOpen = useEditorUiStore((s) => s.setFindOpen);

  return (
    <div className="inspector-panel-content">
      {/* ── Transcription ── */}
      <div className="inspector-section">
        <p className="inspector-section-label">Transcription</p>
        <Button
          className="w-full gap-2"
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:transcribe"))}
        >
          <MicVocal className="h-4 w-4" />
          {hasTranscript ? "Re-Transcribe" : "Transcribe"}
        </Button>
        <p className="inspector-hint">whisper.cpp · Core ML · Apple Silicon · runs locally</p>
      </div>
      <div className="inspector-section">
        <p className="inspector-section-label">Edit Tools</p>
        <Toolbox onFindClick={() => setFindOpen(true)} />
      </div>

      <div className="inspector-divider" />

      {/* ── Media ── */}
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

      {/* ── Export ── */}
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

      <div className="inspector-divider" />

      {/* ── Project ── */}
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

      <div className="inspector-divider" />

      {/* ── Settings ── */}
      <div className="inspector-section">
        <p className="inspector-section-label">Settings</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Cut padding</span>
          <span className="inspector-row-value">—</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Model storage</span>
          <span className="inspector-row-value">—</span>
        </div>
        <p className="inspector-hint">Editor settings coming soon.</p>
      </div>
    </div>
  );
}
