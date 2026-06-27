import { MicVocal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toolbox } from "@/components/Toolbox/Toolbox";
import { useProjectStore } from "@/stores/projectStore";
import { useEditorUiStore } from "@/stores/editorUiStore";

export function TranscriptPanel() {
  const hasTranscript = useProjectStore((s) =>
    s.project.segments.some((seg) => seg.words.length > 0),
  );
  const setFindOpen = useEditorUiStore((s) => s.setFindOpen);

  return (
    <div className="inspector-panel-content">
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
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Edit Tools</p>
        <Toolbox onFindClick={() => setFindOpen(true)} />
      </div>
    </div>
  );
}
