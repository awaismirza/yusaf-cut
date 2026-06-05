/**
 * TipTap inline atom node for a detected silence / pause.
 *
 * Renders as a compact badge, e.g. `[0.6s]` or `[2s]`, inserted between
 * adjacent words wherever ffmpeg silencedetect found a silent gap.
 *
 * The node is read-only (atom: true, contenteditable="false").
 * Clicking a badge triggers `yusafcut:delete-pause` on `window` so the
 * TranscriptEditor can dispatch the source-range deletion without coupling
 * the node to React state.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface PauseAttrs {
  srcStart: number;
  srcEnd: number;
  /** Duration in seconds — pre-computed so renderHTML doesn't need to subtract. */
  duration: number;
}

/** Format a pause duration for display inside the badge. */
export function formatPauseDuration(seconds: number): string {
  return seconds < 10 ? `[${seconds.toFixed(1)}s]` : `[${Math.round(seconds)}s]`;
}

export const PauseNode = Node.create({
  name: "pause",
  inline: true,
  group: "inline",
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      srcStart: { default: 0 },
      srcEnd: { default: 0 },
      duration: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-pause]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = formatPauseDuration(node.attrs.duration as number);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-pause": "",
        "data-src-start": String(node.attrs.srcStart),
        "data-src-end": String(node.attrs.srcEnd),
        class: "pause-marker",
        contenteditable: "false",
        title: `${label} pause — click to remove`,
      }),
      label,
    ];
  },
});
