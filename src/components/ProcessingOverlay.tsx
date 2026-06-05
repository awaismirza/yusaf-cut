/**
 * Full-window blocking overlay shown while a heavy transcript/EDL edit is being
 * applied (see uiStore.withProcessingEdit). Playback is locked independently the
 * instant `isProcessingEdit` flips true; this component only paints the spinner.
 *
 * To avoid a distracting flash on fast edits, the overlay itself only appears
 * after the edit has been running for >150 ms.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

export function ProcessingOverlay() {
  const isProcessingEdit = useUIStore((s) => s.isProcessingEdit);
  const label = useUIStore((s) => s.processingEditLabel);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isProcessingEdit) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(t);
  }, [isProcessingEdit]);

  if (!isProcessingEdit || !visible) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-background/30 backdrop-blur-[1px]">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">{label ?? "Updating timeline…"}</span>
      </div>
    </div>
  );
}
