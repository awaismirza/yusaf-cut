/**
 * Silence-boundary snapping for word timestamps.
 *
 * Whisper word boundaries are approximate; ffmpeg silencedetect boundaries are
 * signal-derived and exact. A word cannot start or end *inside* a silence —
 * so when a whisper boundary lands inside a detected silence, we pull it to
 * the silence edge. This guarantees cuts land in silence, never mid-word.
 *
 * Pure module: no React, no Tauri, no store imports (same rule as lib/edl.ts).
 */

import type { Word } from "./edl";
import type { PauseSegment } from "./ipc";

/**
 * Maximum boundary adjustment, in seconds. A discrepancy larger than this
 * means the timestamp is genuinely elsewhere — moving it would hurt, not help.
 */
export const MAX_SNAP_ADJUSTMENT = 0.12;

/** Minimum surviving word duration after snapping, in seconds. */
const MIN_WORD_DURATION = 0.02;

/** Binary search for the silence containing time `t` (sorted input). */
function silenceAt(silences: PauseSegment[], t: number): PauseSegment | null {
  let lo = 0;
  let hi = silences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = silences[mid];
    if (t < s.start) hi = mid - 1;
    else if (t > s.end) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Snap word boundaries that fall inside detected silences to the silence edge.
 * Words are never moved across their own other boundary, and adjustments are
 * capped at MAX_SNAP_ADJUSTMENT. Returns the input array when nothing changed.
 */
export function snapWordsToSilences(words: Word[], silences: PauseSegment[]): Word[] {
  if (silences.length === 0 || words.length === 0) return words;
  const sorted = [...silences].sort((a, b) => a.start - b.start);
  let changed = false;
  const out = words.map((w) => {
    let start = w.start;
    let end = w.end;

    // A word cannot begin inside a silence — speech starts when silence ends.
    const sStart = silenceAt(sorted, start);
    if (
      sStart &&
      sStart.end - start <= MAX_SNAP_ADJUSTMENT &&
      sStart.end < end - MIN_WORD_DURATION
    ) {
      start = sStart.end;
    }

    // A word cannot end inside a silence — speech stopped when silence began.
    const sEnd = silenceAt(sorted, end);
    if (
      sEnd &&
      end - sEnd.start <= MAX_SNAP_ADJUSTMENT &&
      sEnd.start > start + MIN_WORD_DURATION
    ) {
      end = sEnd.start;
    }

    if (start === w.start && end === w.end) return w;
    changed = true;
    return { ...w, start, end };
  });
  return changed ? out : words;
}
