import { Clapperboard, MicVocal, Music, Scissors, Upload, type LucideIcon } from "lucide-react";
import type React from "react";
import type { WorkspaceMode } from "@/stores/editorUiStore";
import { EditToolsPanel } from "./panels/EditToolsPanel";
import { ExportPanel } from "./panels/ExportPanel";
import { MediaPanel } from "./panels/MediaPanel";
import { MusicPanel } from "./panels/MusicPanel";
import { TranscribePanel } from "./panels/TranscribePanel";

export interface PanelDef {
  id: string;
  icon: LucideIcon;
  label: string;
  modes: WorkspaceMode[];
  component: React.FC;
}

/**
 * Declarative panel registry. Adding a future panel is one entry here plus a
 * component file — the rail and inspector render whatever this list says for
 * the current workspace mode.
 */
export const PANELS: PanelDef[] = [
  { id: "media", icon: Clapperboard, label: "Media", modes: ["transcribe"], component: MediaPanel },
  {
    id: "transcribe",
    icon: MicVocal,
    label: "Transcribe",
    modes: ["transcribe"],
    component: TranscribePanel,
  },
  {
    id: "edit-tools",
    icon: Scissors,
    label: "Edit Tools",
    modes: ["edit"],
    component: EditToolsPanel,
  },
  { id: "music", icon: Music, label: "Music", modes: ["edit"], component: MusicPanel },
  { id: "export", icon: Upload, label: "Export", modes: ["edit"], component: ExportPanel },
];

export function panelsForMode(mode: WorkspaceMode): PanelDef[] {
  return PANELS.filter((p) => p.modes.includes(mode));
}
