/**
 * Recorder setup dialog — pick what to capture, then start with a countdown.
 *
 * Opens via the TopBar Record button, the Media panel, or the global ⌥⌘R
 * shortcut. While a session is running this dialog stays closed; the
 * RecordingHUD takes over.
 */

import { useEffect } from "react";
import { AppWindowMac, Mic, MicOff, MicVocal, MonitorUp, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SHORTCUT_LABELS, useRecordingStore } from "@/stores/recordingStore";
import type { PipCorner, PipSize, RecordMode } from "@/lib/ipc";

const MODES: Array<{ id: RecordMode; label: string; icon: typeof Video; blurb: string }> = [
  { id: "screen", label: "Screen", icon: MonitorUp, blurb: "Display + mic" },
  {
    id: "screen-camera",
    label: "Screen + Camera",
    icon: AppWindowMac,
    blurb: "Webcam bubble",
  },
  { id: "camera", label: "Camera", icon: Video, blurb: "Webcam + mic" },
  { id: "voiceover", label: "Voice over", icon: MicVocal, blurb: "Audio only" },
];

const CORNERS: Array<{ id: PipCorner; label: string }> = [
  { id: "top-left", label: "↖" },
  { id: "top-right", label: "↗" },
  { id: "bottom-left", label: "↙" },
  { id: "bottom-right", label: "↘" },
];

const SIZES: Array<{ id: PipSize; label: string }> = [
  { id: "small", label: "S" },
  { id: "medium", label: "M" },
  { id: "large", label: "L" },
];

export function RecorderDialog() {
  const dialogOpen = useRecordingStore((s) => s.dialogOpen);
  const devices = useRecordingStore((s) => s.devices);
  const devicesError = useRecordingStore((s) => s.devicesError);
  const opts = useRecordingStore((s) => s.opts);
  const setOpts = useRecordingStore((s) => s.setOpts);
  const openDialog = useRecordingStore((s) => s.openDialog);
  const closeDialog = useRecordingStore((s) => s.closeDialog);
  const beginCountdown = useRecordingStore((s) => s.beginCountdown);

  // Legacy entry point used by the Media panel.
  useEffect(() => {
    const onRecord = () => openDialog();
    window.addEventListener("yusafcut:record", onRecord);
    return () => window.removeEventListener("yusafcut:record", onRecord);
  }, [openDialog]);

  const screens = devices?.video.filter((d) => d.isScreen) ?? [];
  const cameras = devices?.video.filter((d) => !d.isScreen) ?? [];
  const mics = devices?.audio ?? [];

  const needsScreen = opts.mode === "screen" || opts.mode === "screen-camera";
  const needsCamera = opts.mode === "screen-camera" || opts.mode === "camera";
  const needsMic = opts.mode === "voiceover";
  const micDisabled = opts.audioIndex === undefined;

  const canStart =
    devices !== null &&
    (!needsScreen || screens.some((s) => s.index === opts.screenIndex)) &&
    (!needsCamera || cameras.some((c) => c.index === opts.cameraIndex)) &&
    (!needsMic || (opts.audioIndex !== undefined && mics.some((m) => m.index === opts.audioIndex)));

  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => (open ? openDialog() : closeDialog())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="recorder-dot" />
            New recording
          </DialogTitle>
          <DialogDescription>
            Everything is captured and processed locally. The finished clip is transcribed and
            appended to the end of your video.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Mode picker */}
          <div className="grid grid-cols-4 gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = opts.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`recorder-mode-btn${active ? " is-active" : ""}`}
                  onClick={() => setOpts({ mode: m.id })}
                >
                  <Icon className="h-5 w-5" />
                  <span>{m.label}</span>
                  <small>{m.blurb}</small>
                </button>
              );
            })}
          </div>

          {devicesError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {devicesError}
            </p>
          )}

          {/* Device pickers */}
          <div className="grid gap-3">
            {needsScreen && (
              <label className="recorder-field">
                <span>
                  <MonitorUp className="h-3.5 w-3.5" /> Display
                </span>
                <select
                  value={opts.screenIndex ?? ""}
                  onChange={(e) => setOpts({ screenIndex: Number(e.target.value) })}
                >
                  {screens.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {needsCamera && (
              <label className="recorder-field">
                <span>
                  <Video className="h-3.5 w-3.5" /> Camera
                </span>
                <select
                  value={opts.cameraIndex ?? ""}
                  onChange={(e) => setOpts({ cameraIndex: Number(e.target.value) })}
                >
                  {cameras.length === 0 && <option value="">No camera found</option>}
                  {cameras.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="recorder-field">
              <span>
                {micDisabled ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}{" "}
                Microphone
              </span>
              <select
                value={opts.audioIndex ?? "none"}
                onChange={(e) =>
                  setOpts({
                    audioIndex: e.target.value === "none" ? undefined : Number(e.target.value),
                  })
                }
              >
                {!needsMic && <option value="none">No microphone</option>}
                {mics.map((m) => (
                  <option key={m.index} value={m.index}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            {opts.mode === "screen-camera" && (
              <div className="flex items-center gap-5">
                <div className="recorder-segmented" role="radiogroup" aria-label="Camera corner">
                  {CORNERS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={opts.pipCorner === c.id}
                      className={opts.pipCorner === c.id ? "is-active" : ""}
                      title={`Camera in ${c.id.replace("-", " ")}`}
                      onClick={() => setOpts({ pipCorner: c.id })}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="recorder-segmented" role="radiogroup" aria-label="Camera size">
                  {SIZES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={opts.pipSize === s.id}
                      className={opts.pipSize === s.id ? "is-active" : ""}
                      title={`Camera bubble ${s.id}`}
                      onClick={() => setOpts({ pipSize: s.id })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">Camera bubble</span>
              </div>
            )}
          </div>

          {/* Shortcut cheat sheet */}
          <div className="recorder-shortcuts">
            <span>
              <kbd>{SHORTCUT_LABELS.record}</kbd> record / stop
            </span>
            <span>
              <kbd>{SHORTCUT_LABELS.pause}</kbd> pause
            </span>
            <span>
              <kbd>{SHORTCUT_LABELS.rerecord}</kbd> re-record
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            className="recorder-start-btn gap-2"
            disabled={!canStart}
            onClick={beginCountdown}
          >
            <span className="recorder-dot is-live" />
            Start recording
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
