import { describe, it, expect } from "vitest";
import {
  addAudioTrack,
  addChapter,
  addMediaWithTranscript,
  computeTimeline,
  deleteWords,
  keepOutputRange,
  newProject,
  outputTimeToSource,
  projectAudioTracks,
  projectChapters,
  sourceTimeToOutput,
  totalDuration,
  wordIdToOutputTime,
  wordIdsInOutputRange,
  type Project,
  type SourceMedia,
  type Word,
} from "@/lib/edl";

/** Sub-nanosecond: the EDL math is f64 seconds, so it must hold far tighter
 * than the 1 ms whisper grid or the frame period that bound real media. */
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

/** n words of `wordLen` seconds separated by `gap` seconds, ids `${prefix}${i}`. */
function words(n: number, wordLen: number, gap: number, prefix = "w", t0 = 0): Word[] {
  return Array.from({ length: n }, (_, i) => {
    const start = t0 + i * (wordLen + gap);
    return { id: `${prefix}${i}`, text: `t${i}`, start, end: start + wordLen, confidence: 1 };
  });
}

function projectOf(n: number, wordLen = 0.4, gap = 0.1, paddingMs = 80): Project {
  const p = newProject("t");
  const dur = n * (wordLen + gap) + 1;
  const withMedia = addMediaWithTranscript(p, media(dur), words(n, wordLen, gap));
  return { ...withMedia, settings: { ...withMedia.settings, paddingMs } };
}

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allWords(p: Project): Word[] {
  return p.segments.flatMap((s) => s.words);
}

describe("keepOutputRange (extract selection)", () => {
  it("keeps only the marked range and drops everything else", () => {
    const p = projectOf(10); // words at 0.5 s pitch, 0.4 s long
    const next = keepOutputRange(p, 1.0, 3.0);
    expect(totalDuration(next)).toBeCloseTo(2.0, 9);
    expect(next.segments).toHaveLength(1);
    expect(next.segments[0]!.sourceIn).toBe(1.0);
    expect(next.segments[0]!.sourceOut).toBe(3.0);
    expect(next.segments[0]!.words.map((w) => w.id)).toEqual(["w2", "w3", "w4", "w5"]);
  });

  it("is order-insensitive for reversed markers", () => {
    const p = projectOf(10);
    const a = keepOutputRange(p, 1.0, 3.0);
    const b = keepOutputRange(p, 3.0, 1.0);
    expect(totalDuration(b)).toBe(totalDuration(a));
    expect(b.segments[0]!.sourceIn).toBe(a.segments[0]!.sourceIn);
    expect(b.segments[0]!.sourceOut).toBe(a.segments[0]!.sourceOut);
  });

  it("returns the same project for an empty, inverted-to-zero or out-of-range selection", () => {
    const p = projectOf(10);
    expect(keepOutputRange(p, 2, 2)).toBe(p);
    expect(keepOutputRange(p, 1000, 2000)).toBe(p);
  });

  it("returns the same project when the range already covers everything", () => {
    const p = projectOf(10);
    expect(keepOutputRange(p, -5, totalDuration(p) + 5)).toBe(p);
  });

  it("uses the parent's exact bounds when the range covers an edge (no float error)", () => {
    const p = projectOf(10);
    const next = keepOutputRange(p, -1, 3.3);
    expect(next.segments[0]!.sourceIn).toBe(p.segments[0]!.sourceIn);
    const tail = keepOutputRange(p, 3.3, 1e6);
    expect(tail.segments[0]!.sourceOut).toBe(p.segments[0]!.sourceOut);
  });

  it("spans multiple segments after a delete, trimming only the outer ones", () => {
    const base = projectOf(12);
    const cut = deleteWords(base, new Set(["w4", "w5", "w6"])); // 3 segments → 2
    expect(cut.segments).toHaveLength(2);
    const tl = computeTimeline(cut);
    const next = keepOutputRange(cut, tl[0]!.outputEnd - 0.5, tl[1]!.outputStart + 0.5);
    expect(next.segments).toHaveLength(2);
    expect(next.segments[0]!.sourceOut).toBe(cut.segments[0]!.sourceOut);
    expect(next.segments[1]!.sourceIn).toBe(cut.segments[1]!.sourceIn);
    expect(totalDuration(next)).toBeCloseTo(1.0, 9);
  });

  it("can trim a segment that has no words (untranscribed clip)", () => {
    const p = addMediaWithTranscript(newProject("t"), media(10), []);
    const next = keepOutputRange(p, 2, 5);
    expect(next.segments).toHaveLength(1);
    expect(next.segments[0]!.sourceIn).toBe(2);
    expect(next.segments[0]!.sourceOut).toBe(5);
  });

  it("keeps words whole when the marker lands mid-word, matching the selection", () => {
    const p = projectOf(10);
    const range: [number, number] = [1.2, 2.2]; // inside w2 (1.0-1.4) .. inside w4 (2.0-2.4)
    const next = keepOutputRange(p, ...range);
    expect(next.segments[0]!.words.map((w) => w.id).sort()).toEqual(
      wordIdsInOutputRange(p, ...range).sort(),
    );
  });

  it("never mutates the input or the words", () => {
    const p = projectOf(10);
    const before = JSON.stringify(p);
    const next = keepOutputRange(p, 1, 3);
    expect(JSON.stringify(p)).toBe(before);
    for (const w of allWords(next)) {
      const orig = allWords(p).find((o) => o.id === w.id)!;
      expect(Object.is(w.start, orig.start)).toBe(true);
      expect(Object.is(w.end, orig.end)).toBe(true);
    }
  });

  it("retimes chapters: shifts those inside, drops those outside", () => {
    let p = projectOf(10);
    p = addChapter(p, 0.5, "before");
    p = addChapter(p, 2.0, "inside");
    p = addChapter(p, 4.0, "after");
    const next = keepOutputRange(p, 1.0, 3.0);
    const chapters = projectChapters(next);
    expect(chapters.map((c) => c.title)).toEqual(["inside"]);
    expect(chapters[0]!.outputTime).toBeCloseTo(1.0, 9);
  });

  it("retimes audio track offsets and clamps one that started before the range", () => {
    let p = projectOf(10);
    p = addAudioTrack(p, { mediaId: "media-1", gainDb: 0, offsetSec: 2.5, ducks: false });
    p = addAudioTrack(p, { mediaId: "media-1", gainDb: 0, offsetSec: 0, ducks: false });
    const next = keepOutputRange(p, 1.0, 3.0);
    const [inside, before] = projectAudioTracks(next);
    expect(inside!.offsetSec).toBeCloseTo(1.5, 9);
    expect(before!.offsetSec).toBeCloseTo(0, 9);
  });
});

describe("deleteWords — padding never duplicates audio", () => {
  it("does not overlap kept segments when the cut is smaller than 2× padding", () => {
    // one 0.1 s word deleted between neighbours; padding 80 ms would overlap by 60 ms
    const p = projectOf(8, 0.1, 0.0, 80);
    const next = deleteWords(p, new Set(["w3"]));
    expect(next.segments).toHaveLength(2);
    const [a, b] = next.segments;
    expect(a!.sourceOut).toBeLessThanOrEqual(b!.sourceIn);
    // and the cut is not erased: at least half of the 0.1 s word is really removed
    expect(b!.sourceIn - a!.sourceOut).toBeGreaterThanOrEqual(0.05 - NS);
  });

  it("keeps the full padding when the cut is large", () => {
    const p = projectOf(10, 0.4, 0.1, 80);
    const next = deleteWords(p, new Set(["w4", "w5", "w6"]));
    const [a, b] = next.segments;
    expect(a!.sourceOut).toBeCloseTo(p.segments[0]!.words[3]!.end + 0.08, 9);
    expect(b!.sourceIn).toBeCloseTo(p.segments[0]!.words[7]!.start - 0.08, 9);
  });

  it("separates degenerate overlapping words instead of overlapping segments", () => {
    const p = projectOf(6, 0.4, 0.1, 80);
    const w = p.segments[0]!.words;
    // DTW can hand back overlapping words: make w3 start before w2 ends
    w[3] = { ...w[3]!, start: w[2]!.end - 0.05, end: w[3]!.end };
    const next = deleteWords(p, new Set(["w2"]));
    for (let i = 1; i < next.segments.length; i++) {
      expect(next.segments[i - 1]!.sourceOut).toBeLessThanOrEqual(next.segments[i]!.sourceIn);
    }
  });

  it("shifts later chapters left by exactly the removed output time", () => {
    let p = projectOf(10, 0.4, 0.1, 0);
    p = addChapter(p, 4.0, "late");
    p = addChapter(p, 1.6, "gone"); // inside w3 (1.5-1.9)
    const next = deleteWords(p, new Set(["w3"]));
    const removed = totalDuration(p) - totalDuration(next);
    const chapters = projectChapters(next);
    expect(chapters.map((c) => c.title)).toEqual(["late"]);
    expect(chapters[0]!.outputTime).toBeCloseTo(4.0 - removed, 9);
  });
});

describe("timeline and word-sync invariants (1e-9 s)", () => {
  it("is contiguous: every outputEnd equals the next outputStart exactly", () => {
    const p = deleteWords(projectOf(40), new Set(["w5", "w6", "w20", "w21", "w22", "w35"]));
    const tl = computeTimeline(p);
    for (let i = 1; i < tl.length; i++) expect(tl[i - 1]!.outputEnd).toBe(tl[i]!.outputStart);
    expect(tl[tl.length - 1]!.outputEnd).toBe(totalDuration(p));
  });

  it("does not drift across 10 000 segments", () => {
    const seg = { id: "", mediaId: "media-1", words: [] as Word[], sourceIn: 0, sourceOut: 1 / 30 };
    const base = addMediaWithTranscript(newProject("t"), media(1), []);
    const p: Project = {
      ...base,
      segments: Array.from({ length: 10_000 }, (_, i) => ({ ...seg, id: `s${i}` })),
    };
    const tl = computeTimeline(p);
    const exact = 10_000 / 30;
    expect(Math.abs(tl[9_999]!.outputEnd - exact)).toBeLessThan(NS);
    expect(Math.abs(totalDuration(p) - exact)).toBeLessThan(NS);
  });

  it("round-trips output ↔ source at every segment edge and midpoint", () => {
    const p = deleteWords(projectOf(30), new Set(["w3", "w4", "w10", "w11", "w12", "w25"]));
    for (const e of computeTimeline(p)) {
      for (const t of [e.outputStart, (e.outputStart + e.outputEnd) / 2]) {
        const src = outputTimeToSource(p, t)!;
        const back = sourceTimeToOutput(p, e.mediaId, src.sourceTime)!;
        expect(Math.abs(back.outputTime - t)).toBeLessThan(NS);
      }
    }
  });

  it("maps every surviving word to outputStart + (word.start − sourceIn)", () => {
    const p = deleteWords(projectOf(30), new Set(["w3", "w4", "w10", "w11", "w12", "w25"]));
    const tl = computeTimeline(p);
    for (const seg of p.segments) {
      const e = tl.find((x) => x.segmentId === seg.id)!;
      for (const w of seg.words) {
        const expected = e.outputStart + Math.max(0, w.start - e.sourceIn);
        expect(Math.abs(wordIdToOutputTime(p, w.id)!.outputTime - expected)).toBeLessThan(NS);
      }
    }
  });

  it("holds under 200 random delete/extract sequences", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      const original = projectOf(
        30 + Math.floor(rand() * 40),
        0.3 + rand() * 0.2,
        rand() * 0.3,
        [0, 40, 80, 200][Math.floor(rand() * 4)]!,
      );
      const originalWords = new Map(allWords(original).map((w) => [w.id, w]));
      let p = original;
      for (let step = 0; step < 6; step++) {
        const total = totalDuration(p);
        if (total < 1) break;
        if (rand() < 0.7) {
          const ids = allWords(p)
            .filter(() => rand() < 0.15)
            .map((w) => w.id);
          p = deleteWords(p, new Set(ids));
        } else {
          const a = rand() * total;
          const b = a + rand() * (total - a);
          p = keepOutputRange(p, a, b);
        }

        // words are never mutated, only dropped
        for (const w of allWords(p)) {
          const o = originalWords.get(w.id)!;
          expect(Object.is(w.start, o.start)).toBe(true);
          expect(Object.is(w.end, o.end)).toBe(true);
        }
        // segments are well-formed, in source order, and never overlap
        for (let i = 0; i < p.segments.length; i++) {
          const s = p.segments[i]!;
          expect(s.sourceOut).toBeGreaterThan(s.sourceIn);
          expect(s.sourceIn).toBeGreaterThanOrEqual(-NS);
          if (i > 0) {
            expect(s.sourceIn).toBeGreaterThanOrEqual(p.segments[i - 1]!.sourceOut - NS);
          }
        }
        // timeline sums to total
        const tl = computeTimeline(p);
        if (tl.length) expect(tl[tl.length - 1]!.outputEnd).toBe(totalDuration(p));
      }
    }
  });
});
