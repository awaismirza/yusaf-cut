import { ArrowRight, MicVocal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorUiStore } from "@/stores/editorUiStore";
import { useProjectStore } from "@/stores/projectStore";

export function TranscribePanel() {
  const hasTranscript = useProjectStore((s) =>
    s.project.segments.some((seg) => seg.words.length > 0),
  );
  const hasMedia = useProjectStore((s) => Object.keys(s.project.media).length > 0);
  const setWorkspaceMode = useEditorUiStore((s) => s.setWorkspaceMode);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Transcription</p>
        <Button
          className="w-full gap-2"
          disabled={!hasMedia}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:transcribe"))}
        >
          <MicVocal className="h-4 w-4" />
          {hasTranscript ? "Re-Transcribe" : "Transcribe"}
        </Button>
        <p className="inspector-hint">whisper.cpp · Core ML · Apple Silicon · runs locally</p>
      </div>
      {hasTranscript && (
        <div className="inspector-section">
          <p className="inspector-section-label">Next step</p>
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setWorkspaceMode("edit")}
          >
            <ArrowRight className="h-4 w-4" />
            Switch to Edit mode
          </Button>
          <p className="inspector-hint">Edit the video by editing the text.</p>
        </div>
      )}
    </div>
  );
}
