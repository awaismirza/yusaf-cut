/**
 * Floating recorder HUD — visible whenever a session is live (countdown,
 * recording, paused, finalizing, processing). Fixed to the top-centre of the
 * window so it stays out of the transcript.
 */

import { Pause, Play, RotateCcw, Square, X } from "lucide-react";
import { formatTimecode } from "@/lib/timecode";
import { SHORTCUT_LABELS, useRecordingStore } from "@/stores/recordingStore";

export function RecordingHUD() {
  const phase = useRecordingStore((s) => s.phase);
  const countdown = useRecordingStore((s) => s.countdown);
  const elapsedSec = useRecordingStore((s) => s.elapsedSec);
  const pause = useRecordingStore((s) => s.pause);
  const resume = useRecordingStore((s) => s.resume);
  const rerecord = useRecordingStore((s) => s.rerecord);
  const stop = useRecordingStore((s) => s.stop);
  const cancel = useRecordingStore((s) => s.cancel);

  if (phase === "idle") return null;

  if (phase === "countdown") {
    return (
      <div className="recorder-countdown" onClick={() => void cancel()} title="Click to cancel">
        <span key={countdown}>{countdown}</span>
        <p>Recording starts… click to cancel</p>
      </div>
    );
  }

  const live = phase === "recording";
  const paused = phase === "paused";
  const busy = phase === "finalizing" || phase === "processing";

  return (
    <div className={`recorder-hud${paused ? " is-paused" : ""}`} role="status">
      <span className={`recorder-dot${live ? " is-live" : ""}`} />
      <span className="recorder-hud-time">{formatTimecode(elapsedSec, { ms: false })}</span>

      {busy ? (
        <span className="recorder-hud-label">
          {phase === "finalizing" ? "Finishing up…" : "Transcribing…"}
        </span>
      ) : (
        <>
          <span className="recorder-hud-label">{paused ? "Paused" : "Recording"}</span>
          <div className="recorder-hud-actions">
            {live ? (
              <button
                type="button"
                onClick={() => void pause()}
                title={`Pause (${SHORTCUT_LABELS.pause})`}
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void resume()}
                title={`Resume (${SHORTCUT_LABELS.pause})`}
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void rerecord()}
              title={`Re-record (${SHORTCUT_LABELS.rerecord})`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="is-stop"
              onClick={() => void stop()}
              title={`Stop & add to video (${SHORTCUT_LABELS.record})`}
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="is-discard"
              onClick={() => void cancel()}
              title="Discard recording"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
