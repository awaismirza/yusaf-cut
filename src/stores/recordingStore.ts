/**
 * Recorder session state + orchestration.
 *
 * Owns the full lifecycle: device discovery, countdown, start / pause /
 * resume / re-record / stop, system-wide shortcuts, window minimise while the
 * screen is captured, and the auto-append pipeline that imports, transcribes,
 * and appends the finished recording to the END of the current EDL.
 *
 * Global shortcuts (registered via tauri-plugin-global-shortcut, so they work
 * while other apps have focus):
 *   ⌥⌘R  start recording / stop when a session is active
 *   ⌥⌘P  pause / resume            (only registered during a session)
 *   ⌥⌘E  re-record the current take (only registered during a session)
 */

import { create } from "zustand";
import {
  cancelRecording,
  detectPauses,
  importMedia,
  listModels,
  listRecordingDevices,
  onRecordError,
  onRecordState,
  pauseRecording,
  resumeRecording,
  startRecording,
  stopRecording,
  transcribe,
  type RecordingDevices,
  type RecordMode,
  type RecordOptions,
  type WhisperModel,
} from "@/lib/ipc";
import { totalDuration, type Word } from "@/lib/edl";
import { snapWordsToSilences } from "@/lib/timestampSnap";
import { writeTranscriptCache } from "@/lib/transcriptCache";
import { useProjectStore } from "@/stores/projectStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useUIStore } from "@/stores/uiStore";

export const RECORD_SHORTCUT = "CmdOrCtrl+Alt+R";
export const PAUSE_SHORTCUT = "CmdOrCtrl+Alt+P";
export const RERECORD_SHORTCUT = "CmdOrCtrl+Alt+E";

export const SHORTCUT_LABELS = {
  record: "⌥⌘R",
  pause: "⌥⌘P",
  rerecord: "⌥⌘E",
} as const;

const OPTS_STORAGE_KEY = "yusafcut.recorderOptions";

/** Best installed Whisper model for auto-transcribing a finished recording. */
const MODEL_PREFERENCE: WhisperModel[] = [
  "large-v3-turbo",
  "large-v3",
  "medium",
  "small",
  "base",
  "tiny",
];

export type RecorderPhase =
  | "idle"
  | "countdown"
  | "recording"
  | "paused"
  | "finalizing"
  | "processing";

interface RecordingState {
  phase: RecorderPhase;
  dialogOpen: boolean;
  /** 3 → 2 → 1 during the pre-roll countdown. */
  countdown: number;
  elapsedSec: number;
  devices: RecordingDevices | null;
  devicesError: string | null;
  opts: RecordOptions;

  openDialog: () => void;
  closeDialog: () => void;
  setOpts: (patch: Partial<RecordOptions>) => void;
  refreshDevices: () => Promise<void>;
  /** Begin the 3-2-1 countdown, then start capture. */
  beginCountdown: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Discard the current take and immediately start a fresh one. */
  rerecord: () => Promise<void>;
  /** Stop, then import + transcribe + append to the end of the EDL. */
  stop: () => Promise<void>;
  /** Abort the session and throw the footage away. */
  cancel: () => Promise<void>;
}

function loadStoredOpts(): RecordOptions {
  try {
    const raw = window.localStorage?.getItem(OPTS_STORAGE_KEY);
    if (raw) return { ...defaultOpts(), ...(JSON.parse(raw) as Partial<RecordOptions>) };
  } catch {
    /* fall through */
  }
  return defaultOpts();
}

function defaultOpts(): RecordOptions {
  return {
    mode: "screen",
    fps: 30,
    pipCorner: "bottom-right",
    pipSize: "medium",
  };
}

function persistOpts(opts: RecordOptions) {
  try {
    window.localStorage?.setItem(OPTS_STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* ignore */
  }
}

function toast(t: { title: string; description?: string; variant?: "destructive" }) {
  useUIStore.getState().pushToast(t);
}

/** Screen capture records the desktop — hide our own window while it runs. */
function capturesScreen(mode: RecordMode) {
  return mode === "screen" || mode === "screen-camera";
}

async function minimizeMainWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  } catch {
    /* browser preview */
  }
}

async function restoreMainWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.unminimize();
    await win.setFocus();
  } catch {
    /* browser preview */
  }
}

export const useRecordingStore = create<RecordingState>()((set, get) => ({
  phase: "idle",
  dialogOpen: false,
  countdown: 0,
  elapsedSec: 0,
  devices: null,
  devicesError: null,
  opts: loadStoredOpts(),

  openDialog: () => {
    if (get().phase !== "idle") return;
    set({ dialogOpen: true });
    void get().refreshDevices();
  },

  closeDialog: () => set({ dialogOpen: false }),

  setOpts: (patch) => {
    const opts = { ...get().opts, ...patch };
    persistOpts(opts);
    set({ opts });
  },

  refreshDevices: async () => {
    try {
      const devices = await listRecordingDevices();
      const { opts } = get();
      const patch: Partial<RecordOptions> = {};
      // Default unset device indices to the first available of each kind.
      const firstScreen = devices.video.find((d) => d.isScreen);
      const firstCamera = devices.video.find((d) => !d.isScreen);
      const firstMic = devices.audio[0];
      if (opts.screenIndex === undefined && firstScreen) patch.screenIndex = firstScreen.index;
      if (opts.cameraIndex === undefined && firstCamera) patch.cameraIndex = firstCamera.index;
      if (opts.audioIndex === undefined && firstMic) patch.audioIndex = firstMic.index;
      set({ devices, devicesError: null, opts: { ...opts, ...patch } });
    } catch (err) {
      set({ devices: null, devicesError: String(err) });
    }
  },

  beginCountdown: () => {
    const { phase, opts } = get();
    if (phase !== "idle") return;
    set({ phase: "countdown", countdown: 3, dialogOpen: false });

    const tick = () => {
      const { phase, countdown } = get();
      if (phase !== "countdown") return; // cancelled
      if (countdown > 1) {
        set({ countdown: countdown - 1 });
        window.setTimeout(tick, 1000);
        return;
      }
      void (async () => {
        if (capturesScreen(opts.mode)) {
          await minimizeMainWindow();
          // Give the minimise animation a beat so it isn't in the capture.
          await new Promise((r) => setTimeout(r, 350));
        }
        try {
          await startRecording(get().opts);
          set({ phase: "recording", elapsedSec: 0 });
          await registerSessionShortcuts();
        } catch (err) {
          set({ phase: "idle", countdown: 0 });
          await restoreMainWindow();
          toast({
            title: "Recording failed to start",
            description: String(err),
            variant: "destructive",
          });
        }
      })();
    };
    window.setTimeout(tick, 1000);
  },

  pause: async () => {
    if (get().phase !== "recording") return;
    try {
      await pauseRecording();
      set({ phase: "paused" });
      if (capturesScreen(get().opts.mode)) await restoreMainWindow();
    } catch (err) {
      toast({ title: "Pause failed", description: String(err), variant: "destructive" });
    }
  },

  resume: async () => {
    if (get().phase !== "paused") return;
    try {
      if (capturesScreen(get().opts.mode)) {
        await minimizeMainWindow();
        await new Promise((r) => setTimeout(r, 350));
      }
      await resumeRecording();
      set({ phase: "recording" });
    } catch (err) {
      toast({ title: "Resume failed", description: String(err), variant: "destructive" });
    }
  },

  rerecord: async () => {
    const { phase, opts } = get();
    if (phase !== "recording" && phase !== "paused") return;
    try {
      await cancelRecording();
      await startRecording(opts);
      set({ phase: "recording", elapsedSec: 0 });
      toast({ title: "Re-recording", description: "Previous take discarded." });
    } catch (err) {
      set({ phase: "idle" });
      await unregisterSessionShortcuts();
      await restoreMainWindow();
      toast({ title: "Re-record failed", description: String(err), variant: "destructive" });
    }
  },

  stop: async () => {
    const { phase } = get();
    if (phase !== "recording" && phase !== "paused") return;
    set({ phase: "finalizing" });
    await unregisterSessionShortcuts();
    try {
      const result = await stopRecording();
      await restoreMainWindow();
      set({ phase: "processing" });
      await appendRecordingToProject(result.path);
    } catch (err) {
      await restoreMainWindow();
      toast({ title: "Recording failed", description: String(err), variant: "destructive" });
    } finally {
      set({ phase: "idle", elapsedSec: 0, countdown: 0 });
    }
  },

  cancel: async () => {
    const { phase } = get();
    if (phase === "countdown") {
      set({ phase: "idle", countdown: 0 });
      return;
    }
    if (phase !== "recording" && phase !== "paused") return;
    await unregisterSessionShortcuts();
    try {
      await cancelRecording();
    } catch {
      /* already gone */
    }
    await restoreMainWindow();
    set({ phase: "idle", elapsedSec: 0 });
    toast({ title: "Recording discarded" });
  },
}));

// ---------------------------------------------------------------------------
// Auto-append pipeline
// ---------------------------------------------------------------------------

/**
 * Import the finished file, transcribe it with the best installed Whisper
 * model, and append it as a new segment at the end of the EDL. If no model is
 * installed the clip is appended untranscribed (nothing is ever lost).
 */
async function appendRecordingToProject(path: string) {
  const setTranscribeProgress = useUIStore.getState().setTranscribeProgress;
  const setMediaLoading = useUIStore.getState().setMediaLoading;

  setMediaLoading(true);
  let media;
  try {
    media = await importMedia(path);
  } catch (err) {
    setMediaLoading(false);
    toast({
      title: "Failed to import recording",
      description: String(err),
      variant: "destructive",
    });
    return;
  }
  setMediaLoading(false);

  let words: Word[] = [];
  let modelUsed: WhisperModel | null = null;
  try {
    const models = await listModels();
    modelUsed =
      MODEL_PREFERENCE.find((name) => models.find((m) => m.name === name)?.installed) ?? null;
    if (modelUsed) {
      setTranscribeProgress(0);
      const result = await transcribe({
        mediaId: media.id,
        mediaPath: media.path,
        engine: "whisper-cpp",
        modelName: modelUsed,
        mediaDuration: media.duration,
      });
      words = result.words;
      try {
        const silences = await detectPauses({
          mediaPath: media.path,
          noiseThreshold: -35,
          minDuration: 0.5,
        });
        words = snapWordsToSilences(words, silences);
      } catch {
        /* non-fatal */
      }
      writeTranscriptCache(media, words);
    }
  } catch (err) {
    toast({
      title: "Transcription failed — clip added without text",
      description: String(err),
      variant: "destructive",
    });
    words = [];
  } finally {
    setTranscribeProgress(null);
  }

  const before = useProjectStore.getState().project;
  const appendAt = totalDuration(before);
  useProjectStore.getState().addMediaWithTranscript(media, words);
  usePlayerStore.getState().clearTimelineRange();
  usePlayerStore.getState().setSelectedWordIds(new Set());
  window.dispatchEvent(new CustomEvent("yusafcut:seek-output", { detail: { time: appendAt } }));

  toast({
    title: words.length > 0 ? "Recording added to end of video" : "Recording added",
    description:
      words.length > 0
        ? `${words.length} words transcribed and appended.`
        : modelUsed
          ? media.path
          : "No Whisper model installed — use the Transcribe panel to add text.",
  });
}

// ---------------------------------------------------------------------------
// Global shortcuts + event stream
// ---------------------------------------------------------------------------

type ShortcutEvent = { state: "Pressed" | "Released" };

async function shortcutApi() {
  return import("@tauri-apps/plugin-global-shortcut");
}

async function registerSessionShortcuts() {
  try {
    const { register } = await shortcutApi();
    await register(PAUSE_SHORTCUT, (event: ShortcutEvent) => {
      if (event.state !== "Pressed") return;
      const { phase, pause, resume } = useRecordingStore.getState();
      if (phase === "recording") void pause();
      else if (phase === "paused") void resume();
    });
    await register(RERECORD_SHORTCUT, (event: ShortcutEvent) => {
      if (event.state !== "Pressed") return;
      void useRecordingStore.getState().rerecord();
    });
  } catch {
    /* shortcut collisions are non-fatal — the HUD buttons still work */
  }
}

async function unregisterSessionShortcuts() {
  try {
    const { unregister } = await shortcutApi();
    await unregister(PAUSE_SHORTCUT);
    await unregister(RERECORD_SHORTCUT);
  } catch {
    /* ignore */
  }
}

/**
 * One-time recorder wiring: the ⌥⌘R shortcut and the Rust event stream.
 * Called from App; returns a disposer.
 */
export async function initRecorder(): Promise<() => void> {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};

  const disposers: Array<() => void> = [];

  try {
    const { register, unregister } = await shortcutApi();
    await register(RECORD_SHORTCUT, (event: ShortcutEvent) => {
      if (event.state !== "Pressed") return;
      const store = useRecordingStore.getState();
      if (store.phase === "recording" || store.phase === "paused") {
        void store.stop();
      } else if (store.phase === "idle") {
        if (store.dialogOpen) store.beginCountdown();
        else store.openDialog();
      }
    });
    disposers.push(() => void unregister(RECORD_SHORTCUT).catch(() => {}));
  } catch {
    /* another app holds the hotkey — recorder still usable from the UI */
  }

  const unState = await onRecordState((p) => {
    const store = useRecordingStore.getState();
    // Elapsed ticks; state transitions are driven by the store's own actions,
    // so only sync the timer + unexpected terminal states here.
    if (p.state === "recording" || p.state === "paused") {
      useRecordingStore.setState({ elapsedSec: p.elapsedSec });
    } else if (p.state === "idle" && (store.phase === "recording" || store.phase === "paused")) {
      // Backend session died out from under us.
      useRecordingStore.setState({ phase: "idle", elapsedSec: 0 });
    }
  });
  disposers.push(unState);

  const unError = await onRecordError((message) => {
    const store = useRecordingStore.getState();
    if (store.phase === "recording" || store.phase === "paused") {
      void unregisterSessionShortcuts();
      void restoreMainWindow();
      useRecordingStore.setState({ phase: "idle", elapsedSec: 0 });
    }
    toast({ title: "Recording error", description: message, variant: "destructive" });
  });
  disposers.push(unError);

  return () => disposers.forEach((d) => d());
}
