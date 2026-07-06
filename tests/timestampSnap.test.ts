import { describe, expect, it } from "vitest";
import type { Word } from "@/lib/edl";
import type { PauseSegment } from "@/lib/ipc";
import { snapWordsToSilences } from "@/lib/timestampSnap";

function word(id: string, start: number, end: number): Word {
  return { id, text: id, start, end, confidence: 1 };
}

function silence(start: number, end: number): PauseSegment {
  return { id: `${start}-${end}`, start, end, duration: end - start };
}

describe("snapWordsToSilences", () => {
  it("snaps a word start that falls inside a silence forward to the silence end", () => {
    const out = snapWordsToSilences([word("w", 1.45, 2.0)], [silence(0.9, 1.5)]);
    expect(out[0].start).toBeCloseTo(1.5, 9);
    expect(out[0].end).toBeCloseTo(2.0, 9);
  });

  it("snaps a word end that falls inside a silence back to the silence start", () => {
    const out = snapWordsToSilences([word("w", 1.0, 1.58)], [silence(1.5, 2.2)]);
    expect(out[0].start).toBeCloseTo(1.0, 9);
    expect(out[0].end).toBeCloseTo(1.5, 9);
  });

  it("leaves boundaries alone when the adjustment exceeds the 120 ms tolerance", () => {
    // end is 0.5 s past the silence start — too far to be a boundary error.
    const out = snapWordsToSilences([word("w", 0.5, 2.0)], [silence(1.5, 2.5)]);
    expect(out[0].start).toBeCloseTo(0.5, 9);
    expect(out[0].end).toBeCloseTo(2.0, 9);
  });

  it("never produces a degenerate (near-zero-duration) word", () => {
    // Snapping start to 1.5 would leave only 20 ms of word — skip it.
    const out = snapWordsToSilences([word("w", 1.45, 1.52)], [silence(0.9, 1.5)]);
    expect(out[0].start).toBeCloseTo(1.45, 9);
    expect(out[0].end).toBeCloseTo(1.52, 9);
  });

  it("leaves words untouched when they overlap no silence", () => {
    const words = [word("a", 0.0, 0.4), word("b", 0.5, 0.9)];
    const out = snapWordsToSilences(words, [silence(2.0, 3.0)]);
    expect(out[0]).toEqual(words[0]);
    expect(out[1]).toEqual(words[1]);
  });

  it("returns the input array unchanged when there are no silences", () => {
    const words = [word("a", 0.0, 0.4)];
    expect(snapWordsToSilences(words, [])).toBe(words);
  });

  it("handles unsorted silence input", () => {
    const out = snapWordsToSilences(
      [word("w", 3.05, 4.0)],
      [silence(5.0, 6.0), silence(2.5, 3.1)],
    );
    expect(out[0].start).toBeCloseTo(3.1, 9);
  });
});
