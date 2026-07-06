import { beforeEach, describe, expect, it } from "vitest";
import { useRecordingStore } from "@/stores/recordingStore";

describe("recordingStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useRecordingStore.setState({
      phase: "idle",
      dialogOpen: false,
      countdown: 0,
      elapsedSec: 0,
      devices: null,
      devicesError: null,
    });
  });

  describe("options", () => {
    it("defaults to screen mode with a bottom-right medium camera bubble", () => {
      const { opts } = useRecordingStore.getState();
      expect(opts.mode).toBe("screen");
      expect(opts.pipCorner).toBe("bottom-right");
      expect(opts.pipSize).toBe("medium");
      expect(opts.fps).toBe(30);
    });

    it("setOpts merges a patch and persists it for the next session", () => {
      useRecordingStore.getState().setOpts({ mode: "screen-camera", pipCorner: "top-left" });
      const { opts } = useRecordingStore.getState();
      expect(opts.mode).toBe("screen-camera");
      expect(opts.pipCorner).toBe("top-left");
      // Untouched fields survive the merge.
      expect(opts.pipSize).toBe("medium");

      const stored = JSON.parse(
        window.localStorage.getItem("yusafcut.recorderOptions") ?? "{}",
      ) as Record<string, unknown>;
      expect(stored.mode).toBe("screen-camera");
      expect(stored.pipCorner).toBe("top-left");
    });
  });

  describe("phase guards", () => {
    it("openDialog is ignored while a session is live", () => {
      useRecordingStore.setState({ phase: "recording" });
      useRecordingStore.getState().openDialog();
      expect(useRecordingStore.getState().dialogOpen).toBe(false);
    });

    it("pause / resume / stop are no-ops outside their valid phases", async () => {
      await useRecordingStore.getState().pause();
      expect(useRecordingStore.getState().phase).toBe("idle");

      await useRecordingStore.getState().resume();
      expect(useRecordingStore.getState().phase).toBe("idle");

      await useRecordingStore.getState().stop();
      expect(useRecordingStore.getState().phase).toBe("idle");
    });

    it("beginCountdown enters countdown at 3 and cancel aborts before capture starts", async () => {
      useRecordingStore.getState().beginCountdown();
      const s = useRecordingStore.getState();
      expect(s.phase).toBe("countdown");
      expect(s.countdown).toBe(3);
      expect(s.dialogOpen).toBe(false);

      await useRecordingStore.getState().cancel();
      expect(useRecordingStore.getState().phase).toBe("idle");
      expect(useRecordingStore.getState().countdown).toBe(0);
    });

    it("beginCountdown is ignored when a session is already live", () => {
      useRecordingStore.setState({ phase: "paused" });
      useRecordingStore.getState().beginCountdown();
      expect(useRecordingStore.getState().phase).toBe("paused");
    });
  });
});
