import { beforeEach, describe, expect, it } from "vitest";
import {
  addChapter,
  addMediaWithTranscript,
  computeTimeline,
  newProject,
  projectChapters,
  totalDuration,
  trimSourceRanges,
  type Project,
  type SourceMedia,
  type Word,
} from "@/lib/edl";
import { useProjectStore } from "@/stores/projectStore";

const NS = 1e-9;

function media(duration: number, id = "media-1"): SourceMedia {
  return {
    id,
    path: `/tmp/${id}.mp4`,
    duration,
    fps: 30,
    width: 1920,
    height: 1080,
    audioSampleRate: 48000,
    sha256: "deadbeef",
  };
}

function word(id: string, start: number, end: number): Word {
  return { id, text: id, start, end, confidence: 1 };
}

/** w0 0–1, a 2 s pause, w1 3–4, a 1 s pause, w2 5–6; media is 7 s long. */
function project(): Project {
  return addMediaWithTranscript(newProject("t"), media(7), [
    word("w0", 0, 1),
    word("w1", 3, 4),
    word("w2", 5, 6),
  ]);
}

function allWords(p: Project): Word[] {
  return p.segments.flatMap((s) => s.words);
}

describe("trimSourceRanges (shorten pauses)", () => {
  it("cuts the range out of the timeline and splits the segment", () => {
    const p = project();
    const [next, cut] = trimSourceRanges(p, "media-1", [{ start: 1.25, end: 2.75 }]);
    expect(cut).toBe(1);
    expect(totalDuration(next)).toBeCloseTo(7 - 1.5, 9);
    expect(next.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [0, 1.25],
      [2.75, 7],
    ]);
    expect(next.segments.map((s) => s.words.map((w) => w.id))).toEqual([["w0"], ["w1", "w2"]]);
  });

  it("never removes or clips a word, even when the range covers one", () => {
    const p = project();
    const [next] = trimSourceRanges(p, "media-1", [{ start: 0.5, end: 3.5 }]);
    // Only the silence between w0 and w1 (1–3) can go.
    expect(totalDuration(next)).toBeCloseTo(7 - 2, 9);
    expect(allWords(next).map((w) => w.id)).toEqual(["w0", "w1", "w2"]);
    for (const w of allWords(next)) {
      const seg = next.segments.find((s) => s.words.includes(w))!;
      expect(w.start).toBeGreaterThanOrEqual(seg.sourceIn - NS);
      expect(w.end).toBeLessThanOrEqual(seg.sourceOut + NS);
    }
  });

  it("merges overlapping ranges and counts each range that cut", () => {
    const p = project();
    const [next, cut] = trimSourceRanges(p, "media-1", [
      { start: 1.2, end: 2.0 },
      { start: 1.8, end: 2.8 },
      { start: 5.2, end: 5.8 }, // inside w2: nothing to cut
    ]);
    expect(cut).toBe(2);
    expect(totalDuration(next)).toBeCloseTo(7 - 1.6, 9);
  });

  it("returns the same project when nothing would be cut", () => {
    const p = project();
    expect(trimSourceRanges(p, "media-1", [])[0]).toBe(p);
    expect(trimSourceRanges(p, "media-1", [{ start: 3.1, end: 3.9 }])[0]).toBe(p);
    expect(trimSourceRanges(p, "other-media", [{ start: 1.2, end: 2.8 }])[0]).toBe(p);
  });

  it("keeps the timeline contiguous and words unmutated", () => {
    const p = project();
    const before = JSON.stringify(p);
    const [next] = trimSourceRanges(p, "media-1", [
      { start: 1.5, end: 2.5 },
      { start: 4.25, end: 4.75 },
    ]);
    expect(JSON.stringify(p)).toBe(before);
    const tl = computeTimeline(next);
    for (let i = 1; i < tl.length; i++) expect(tl[i - 1]!.outputEnd).toBe(tl[i]!.outputStart);
    expect(allWords(next)).toEqual(allWords(p));
  });

  it("shifts later chapters left by the removed time", () => {
    const p = addChapter(project(), 5, "late");
    const [next] = trimSourceRanges(p, "media-1", [{ start: 1.5, end: 2.5 }]);
    expect(projectChapters(next)[0]!.outputTime).toBeCloseTo(4, 9);
  });
});

describe("projectStore.shortenPausesLongerThan", () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: project(),
      dirty: false,
      pauseTokens: [
        { id: "p-long", start: 1, end: 3, duration: 2 },
        { id: "p-short", start: 4, end: 5, duration: 1 },
      ],
    });
  });

  it("cuts only pauses over the threshold, keeping shortenTo seconds of silence", () => {
    const n = useProjectStore
      .getState()
      .shortenPausesLongerThan({ longerThan: 1.5, shortenTo: 0.5 });
    const { project: next, pauseTokens, dirty } = useProjectStore.getState();
    expect(n).toBe(1);
    expect(dirty).toBe(true);
    // 2 s pause → 0.5 s: 1.5 s removed from the timeline (and so from export).
    expect(totalDuration(next)).toBeCloseTo(7 - 1.5, 9);
    expect(next.segments.map((s) => [s.sourceIn, s.sourceOut])).toEqual([
      [0, 1.25],
      [2.75, 7],
    ]);
    expect(pauseTokens.find((p) => p.id === "p-long")!.shortenedTo).toBe(0.5);
    expect(pauseTokens.find((p) => p.id === "p-short")!.shortenedTo).toBeUndefined();
  });

  it("does not cut again when re-run with the same length", () => {
    const s = useProjectStore.getState();
    s.shortenPausesLongerThan({ longerThan: 1.5, shortenTo: 0.5 });
    const after = useProjectStore.getState().project;
    expect(s.shortenPausesLongerThan({ longerThan: 1.5, shortenTo: 0.5 })).toBe(0);
    expect(useProjectStore.getState().project).toBe(after);
  });
});
