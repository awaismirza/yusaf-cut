/**
 * The project store is the single source of truth for the EDL.
 *
 * Every edit funnels through this store; `zundo` wraps it to give us undo/redo
 * with a 50-step ring buffer (per spec Phase 4).
 *
 * Heuristic: snapshot on every edit. We are not concerned about memory — the
 * EDL is tiny compared to the media files it references.
 */

import { temporal, type TemporalState } from "zundo";
import { create, useStore } from "zustand";
import {
  addAudioTrack,
  addChapter,
  addMediaWithTranscript,
  deleteWords,
  newProject,
  removeAudioTrack,
  removeChapter,
  removeSilences,
  renameChapter,
  updateAudioTrack,
  wordIdsInOutputRange,
  type AudioTrack,
  type Project,
  type SourceMedia,
  type Word,
} from "@/lib/edl";
import type { PauseSegment } from "@/lib/ipc";

interface ProjectState {
  project: Project;
  /** True when the project has unsaved changes since the last save. */
  dirty: boolean;
  /** Absolute path on disk; null for an unsaved project. */
  filePath: string | null;

  // Mutations
  setProject: (p: Project) => void;
  rename: (name: string) => void;
  addMediaWithTranscript: (media: SourceMedia, words: Word[]) => void;
  deleteWords: (ids: Iterable<string>) => void;
  deleteOutputRange: (markIn: number, markOut: number) => number;
  /** Delete every word whose source-media span overlaps [srcStart, srcEnd].
   *  Use this with timestamps returned by ffmpeg silencedetect, which operates
   *  on the original source file. Returns the count of words removed. */
  deleteBySourceRange: (srcStart: number, srcEnd: number) => number;
  /**
   * Delete only words whose **full** source-media span falls within
   * [srcStart, srcEnd] (±30 ms tolerance).  Safer than `deleteBySourceRange`
   * for cutting silences because it does not accidentally delete a word that
   * merely abuts the silence boundary.  Returns the count of words removed.
   *
   * NOTE: Silent gaps themselves (the space between words in the same segment)
   * are not explicitly removed from the export timeline in Phase 1.  That
   * requires segment splitting and is planned for Phase 2.
   */
  deleteSilenceRange: (srcStart: number, srcEnd: number) => number;
  /** Delete every word whose text (case-insensitive, punctuation-stripped)
   *  matches one of the given tokens. Returns the count of words removed. */
  deleteWordsByText: (tokens: ReadonlySet<string>) => number;
  /** Replace the text of every word whose token equals `find` (case-insensitive)
   *  with `replace`. Returns the count of replacements made. */
  replaceText: (
    find: string,
    replace: string,
    opts?: { caseSensitive?: boolean; wholeWord?: boolean },
  ) => number;
  /** Cut every silence longer than `gapMs` between surviving words.
   *  Returns the count of silences removed (0 = nothing to do). */
  removeSilences: (gapMs?: number) => number;
  /** Chapter ops on the OUTPUT timeline. */
  addChapter: (outputTime: number, title?: string) => void;
  removeChapter: (id: string) => void;
  renameChapter: (id: string, title: string) => void;
  /**
   * Bulk-replace all chapters with an AI-generated set.
   *
   * Each entry needs only `title` and `outputTime`; stable UUIDs are assigned
   * here. The existing chapter list is replaced, not merged, so the user gets
   * a clean slate they can edit from.
   */
  setChapters: (chapters: Array<{ title: string; outputTime: number }>) => void;
  /** Audio-track ops (music beds / sfx mixed under the main EDL). */
  addAudioTrack: (track: Omit<AudioTrack, "id">) => void;
  removeAudioTrack: (id: string) => void;
  updateAudioTrack: (
    id: string,
    patch: Partial<Omit<AudioTrack, "id" | "mediaId">>,
  ) => void;
  /** Add a SourceMedia entry without creating a transcript segment for it.
   *  Used when importing a music file purely as an audio-track input. */
  addMediaOnly: (media: SourceMedia) => void;
  markSaved: (path: string) => void;
  closeProject: () => void;

  // ---------------------------------------------------------------------------
  // Pause tokens — detected silences displayed as inline [0.6s] badges.
  //
  // Stored here (rather than uiStore) so they survive undo/redo of EDL edits
  // and can eventually be saved with the project file.
  //
  // Phase 1 limitation: pauseTokens are NOT yet written to the .scribe bundle.
  // TODO Phase 2: serialize pauseTokens into project.json so they reload.
  // ---------------------------------------------------------------------------

  /** Currently detected pause segments for the loaded project. */
  pauseTokens: PauseSegment[];
  /** Replace the pause list (e.g. after a fresh detect_pauses run). */
  setPauseTokens: (pauses: PauseSegment[]) => void;
  /** Remove a pause token by id without touching the EDL. */
  removePauseToken: (id: string) => void;
  /** Mark a pause as deleted (EDL cut already applied elsewhere). */
  markPauseDeleted: (id: string) => void;
  /** Cut the EDL source range for this pause AND remove it from the list. */
  deletePauseById: (id: string) => void;
  /**
   * Cut the source range for every pause longer than `seconds` and remove
   * those tokens.  Returns the count of pauses deleted.
   */
  deletePausesLongerThan: (seconds: number) => number;
  /**
   * Visually shorten all pauses longer than `longerThan` to `shortenTo`
   * seconds by updating `shortenedTo` on matching tokens.
   *
   * NOTE Phase 1: This updates the displayed badge only.  Actual EDL segment
   * trimming (cutting silence from the export timeline) requires segment
   * splitting and is planned for Phase 2.
   *
   * Returns the count of pauses shortened.
   */
  shortenPausesLongerThan: (opts: { longerThan: number; shortenTo: number }) => number;
}

/**
 * When cutting a silence range, only delete words whose FULL source span is
 * within [srcStart, srcEnd].  A 30 ms tolerance prevents accidentally deleting
 * a word that merely abuts the silence boundary.
 */
const SILENCE_TOLERANCE = 0.03;

function computeSilenceWordIds(project: Project, srcStart: number, srcEnd: number): string[] {
  const ids: string[] = [];
  for (const seg of project.segments) {
    for (const w of seg.words) {
      if (w.start >= srcStart - SILENCE_TOLERANCE && w.end <= srcEnd + SILENCE_TOLERANCE) {
        ids.push(w.id);
      }
    }
  }
  return ids;
}

/** Strip surrounding punctuation/whitespace and lowercase. */
function normaliseToken(s: string): string {
  return s
    .trim()
    .replace(/^[\s.,!?;:"'()[\]{}—–-]+|[\s.,!?;:"'()[\]{}—–-]+$/g, "")
    .toLowerCase();
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, _get) => ({
      project: newProject("Untitled"),
      dirty: false,
      filePath: null,
      pauseTokens: [],

      setProject: (p) => set({ project: p, dirty: true }),

      rename: (name) =>
        set((s) => ({
          project: { ...s.project, name, updatedAt: new Date().toISOString() },
          dirty: true,
        })),

      addMediaWithTranscript: (media, words) =>
        set((s) => ({
          project: addMediaWithTranscript(s.project, media, words),
          dirty: true,
        })),

      deleteWords: (ids) =>
        set((s) => ({
          project: deleteWords(s.project, new Set(ids)),
          dirty: true,
        })),

      deleteOutputRange: (markIn, markOut) => {
        const project = _get().project;
        const ids = wordIdsInOutputRange(project, markIn, markOut);
        if (ids.length === 0) return 0;
        set({
          project: deleteWords(project, new Set(ids)),
          dirty: true,
        });
        return ids.length;
      },

      deleteBySourceRange: (srcStart, srcEnd) => {
        const project = _get().project;
        const ids: string[] = [];
        for (const seg of project.segments) {
          for (const w of seg.words) {
            // word.start / word.end are already in source-media seconds
            if (w.end > srcStart && w.start < srcEnd) {
              ids.push(w.id);
            }
          }
        }
        if (ids.length === 0) return 0;
        set({
          project: deleteWords(project, new Set(ids)),
          dirty: true,
        });
        return ids.length;
      },

      deleteSilenceRange: (srcStart, srcEnd) => {
        const project = _get().project;
        const ids = computeSilenceWordIds(project, srcStart, srcEnd);
        if (ids.length === 0) return 0;
        set({ project: deleteWords(project, new Set(ids)), dirty: true });
        return ids.length;
      },

      deleteWordsByText: (tokens) => {
        let removed = 0;
        const ids: string[] = [];
        const project = _get().project;
        for (const seg of project.segments) {
          for (const w of seg.words) {
            if (tokens.has(normaliseToken(w.text))) {
              ids.push(w.id);
              removed++;
            }
          }
        }
        if (ids.length === 0) return 0;
        set({
          project: deleteWords(project, new Set(ids)),
          dirty: true,
        });
        return removed;
      },

      replaceText: (find, replace, opts) => {
        const caseSensitive = opts?.caseSensitive ?? false;
        const wholeWord = opts?.wholeWord ?? true;
        const needle = caseSensitive ? find : find.toLowerCase();
        if (needle.length === 0) return 0;
        let replaced = 0;
        const project = _get().project;
        const nextSegments = project.segments.map((seg) => ({
          ...seg,
          words: seg.words.map((w) => {
            const haystack = caseSensitive ? w.text : w.text.toLowerCase();
            if (wholeWord) {
              // Whole-word match — compare token without surrounding punctuation
              const norm = caseSensitive
                ? w.text.trim().replace(/^[\s.,!?;:"'()[\]{}—–-]+|[\s.,!?;:"'()[\]{}—–-]+$/g, "")
                : normaliseToken(w.text);
              if (norm === needle) {
                replaced++;
                // Preserve trailing punctuation so the transcript reads naturally
                const trailing = w.text.match(/[\s.,!?;:"'()[\]{}—–-]+$/)?.[0] ?? "";
                return { ...w, text: replace + trailing };
              }
              return w;
            }
            // Substring search
            if (!haystack.includes(needle)) return w;
            const re = caseSensitive
              ? new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
              : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
            const newText = w.text.replace(re, () => {
              replaced++;
              return replace;
            });
            return { ...w, text: newText };
          }),
        }));
        if (replaced === 0) return 0;
        set({
          project: { ...project, segments: nextSegments, updatedAt: new Date().toISOString() },
          dirty: true,
        });
        return replaced;
      },

      removeSilences: (gapMs) => {
        const project = _get().project;
        const [next, removed] = removeSilences(project, gapMs ? { gapMs } : undefined);
        if (removed === 0) return 0;
        set({ project: next, dirty: true });
        return removed;
      },

      addChapter: (outputTime, title) =>
        set((s) => ({ project: addChapter(s.project, outputTime, title), dirty: true })),
      removeChapter: (id) =>
        set((s) => ({ project: removeChapter(s.project, id), dirty: true })),
      renameChapter: (id, title) =>
        set((s) => ({ project: renameChapter(s.project, id, title), dirty: true })),
      setChapters: (chapters) =>
        set((s) => ({
          project: {
            ...s.project,
            chapters: chapters.map((c) => ({
              id: crypto.randomUUID(),
              title: c.title,
              outputTime: c.outputTime,
            })),
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      addAudioTrack: (track) =>
        set((s) => ({ project: addAudioTrack(s.project, track), dirty: true })),
      removeAudioTrack: (id) =>
        set((s) => ({ project: removeAudioTrack(s.project, id), dirty: true })),
      updateAudioTrack: (id, patch) =>
        set((s) => ({ project: updateAudioTrack(s.project, id, patch), dirty: true })),
      addMediaOnly: (media) =>
        set((s) => ({
          project: {
            ...s.project,
            media: { ...s.project.media, [media.id]: media },
            updatedAt: new Date().toISOString(),
          },
          dirty: true,
        })),

      markSaved: (path) => set({ dirty: false, filePath: path }),

      closeProject: () =>
        set({
          project: newProject("Untitled"),
          dirty: false,
          filePath: null,
          pauseTokens: [],
        }),

      // -----------------------------------------------------------------------
      // Pause token actions
      // -----------------------------------------------------------------------

      setPauseTokens: (pauses) => set({ pauseTokens: pauses }),

      removePauseToken: (id) =>
        set((s) => ({ pauseTokens: s.pauseTokens.filter((p) => p.id !== id) })),

      markPauseDeleted: (id) =>
        set((s) => ({
          pauseTokens: s.pauseTokens.map((p) => (p.id === id ? { ...p, deleted: true } : p)),
        })),

      deletePauseById: (id) => {
        const { pauseTokens } = _get();
        const pause = pauseTokens.find((p) => p.id === id);
        if (!pause) return;
        const project = _get().project;
        const wordIds = computeSilenceWordIds(project, pause.start, pause.end);
        set({
          project: wordIds.length > 0 ? deleteWords(project, new Set(wordIds)) : project,
          dirty: wordIds.length > 0,
          pauseTokens: pauseTokens.filter((p) => p.id !== id),
        });
      },

      deletePausesLongerThan: (seconds) => {
        const { pauseTokens } = _get();
        const targets = pauseTokens.filter((p) => !p.deleted && p.duration > seconds);
        if (targets.length === 0) return 0;
        let project = _get().project;
        let anyDeleted = false;
        for (const pause of targets) {
          const wordIds = computeSilenceWordIds(project, pause.start, pause.end);
          if (wordIds.length > 0) {
            project = deleteWords(project, new Set(wordIds));
            anyDeleted = true;
          }
        }
        const targetIds = new Set(targets.map((p) => p.id));
        set({
          project,
          dirty: anyDeleted,
          pauseTokens: pauseTokens.filter((p) => !targetIds.has(p.id)),
        });
        return targets.length;
      },

      shortenPausesLongerThan: ({ longerThan, shortenTo }) => {
        const { pauseTokens } = _get();
        const targets = pauseTokens.filter((p) => !p.deleted && p.duration > longerThan);
        if (targets.length === 0) return 0;
        const targetIds = new Set(targets.map((p) => p.id));
        set({
          pauseTokens: pauseTokens.map((p) =>
            targetIds.has(p.id) ? { ...p, shortenedTo: shortenTo } : p,
          ),
        });
        // TODO Phase 2: trim the source segment to remove (pause.start + shortenTo, pause.end)
        // from the export timeline.  This requires an EDL segment-splitting operation.
        return targets.length;
      },
    }),
    {
      // Per spec: cap undo at 50 steps.
      limit: 50,
      // Only snapshot the `project` field — don't churn the stack on dirty/path changes.
      partialize: (state) => ({ project: state.project }),
      // Throttle bursts (e.g. typed deletes) so we don't fill the stack.
      handleSet: (handleSet) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        return (state) => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => handleSet(state), 100);
        };
      },
    },
  ),
);

/**
 * Replace the project as loaded baseline state, not as an undoable edit.
 * Open/import/transcribe completion should not become "undo transcription".
 */
export function replaceProjectBaseline(
  project: Project,
  opts: { filePath?: string | null; dirty?: boolean } = {},
) {
  const temporalStore = useProjectStore.temporal.getState();
  temporalStore.pause();
  useProjectStore.setState({
    project,
    dirty: opts.dirty ?? false,
    filePath: opts.filePath ?? null,
  });
  temporalStore.clear();
  setTimeout(() => {
    temporalStore.clear();
    temporalStore.resume();
  }, 150);
}

/** Helper for components to access undo/redo. */
export function useTemporalProjectStore<T>(
  selector: (state: TemporalState<{ project: Project }>) => T,
): T {
  // The temporal store is exposed as a method on the main store.
  return useStore(useProjectStore.temporal, selector);
}
