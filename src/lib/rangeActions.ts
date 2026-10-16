// Mark In / Mark Out actions shared by the keyboard shortcuts and the Toolbox.
//
// Markers are output-timeline seconds held in `playerStore`. Set/Out also mirror
// the range into the word selection so the transcript highlights it.

import { wordIdsInOutputRange } from "@/lib/edl";
import { useEditorUiStore } from "@/stores/editorUiStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUIStore } from "@/stores/uiStore";

function syncSelection() {
  const s = usePlayerStore.getState();
  if (s.timelineMarkIn === null || s.timelineMarkOut === null) return;
  s.setSelectedWordIds(
    wordIdsInOutputRange(useProjectStore.getState().project, s.timelineMarkIn, s.timelineMarkOut),
  );
}

export function setMarkIn() {
  const s = usePlayerStore.getState();
  s.setTimelineRange(s.currentTime, s.timelineMarkOut);
  syncSelection();
}

export function setMarkOut() {
  const s = usePlayerStore.getState();
  s.setTimelineRange(s.timelineMarkIn, s.currentTime);
  syncSelection();
}

export function clearMarkers() {
  const s = usePlayerStore.getState();
  s.clearTimelineRange();
  s.setSelectedWordIds([]);
}

export type RangeOp = "delete" | "extract";

/**
 * Apply a destructive edit to the marked range: `delete` ripple-removes it,
 * `extract` keeps only it. Returns false when it did nothing (no complete
 * range, review-only mode, or the edit changed nothing).
 */
export async function applyMarkedRange(op: RangeOp): Promise<boolean> {
  // Transcribe mode is review-only: no destructive edits.
  if (useEditorUiStore.getState().workspaceMode === "transcribe") return false;
  const player = usePlayerStore.getState();
  const { timelineMarkIn: markIn, timelineMarkOut: markOut } = player;
  if (markIn === null || markOut === null) return false;

  const ui = useUIStore.getState();
  const projectStore = useProjectStore.getState();
  const label = op === "delete" ? "Deleting selection…" : "Extracting selection…";
  let changed = false;
  await ui.withProcessingEdit(label, () => {
    const before = projectStore.project;
    if (op === "delete") projectStore.deleteOutputRange(markIn, markOut);
    else projectStore.keepOutputRange(markIn, markOut);
    changed = useProjectStore.getState().project !== before;
  });

  if (!changed) {
    ui.pushToast({
      // Delete removes whole words only; extract trims footage in source time.
      title: op === "delete" ? "Nothing to delete" : "Nothing to extract",
      description:
        op === "delete"
          ? "The marked range does not cover any transcript words."
          : "The marked range does not cover any footage.",
    });
    return false;
  }

  // Delete leaves the playhead at the seam; extract starts the new timeline.
  const seekTo = op === "delete" ? Math.min(markIn, markOut) : 0;
  player.clearTimelineRange();
  player.setSelectedWordIds([]);
  player.setCurrentTime(seekTo);
  window.dispatchEvent(
    new CustomEvent("yusafcut:seek-output", { detail: { time: seekTo, play: false } }),
  );
  return true;
}
