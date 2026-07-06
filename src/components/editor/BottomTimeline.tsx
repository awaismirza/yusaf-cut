import { Waveform } from "@/components/Waveform/Waveform";

/**
 * Bottom timeline area — currently wraps the waveform/clip overview.
 * This area will grow into the full transcript/clip timeline in a future pass.
 */
export function BottomTimeline() {
  return (
    <div className="bottom-timeline">
      <Waveform />
    </div>
  );
}
