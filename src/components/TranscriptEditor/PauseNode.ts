/**
 * TipTap inline atom node for a detected silence / pause.
 *
 * Renders as a compact badge, e.g. `[0.6s]` or `[2s]`, inserted between
 * adjacent words wherever ffmpeg silencedetect found a silent gap.
 *
 * The node is read-only (atom: true, contenteditable="false") but is
 * selectable.  When selected, pressing Delete or Backspace fires the
 * `yusafcut:delete-pause` window event so TranscriptEditor can dispatch
 * the source-range deletion without coupling this node to React state.
 *
 * Clicking a badge also fires the same event.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface PauseAttrs {
  /** Stable UUID from the backend — used for id-based removal. */
  pauseId: string;
  srcStart: number;
  srcEnd: number;
  /** `srcEnd - srcStart` — pre-computed by the backend. */
  duration: number;
}

/** Format a pause duration for display inside the badge. */
export function formatPauseDuration(seconds: number): string {
  // Always show one decimal place for sub-10-second pauses (e.g. [0.6s], [1.2s]).
  // Round to nearest whole second for longer pauses (e.g. [12s]).
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
      pauseId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-pause-id") ?? "",
        renderHTML: (attrs) => ({ "data-pause-id": attrs.pauseId as string }),
      },
      srcStart: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-src-start") ?? 0),
        renderHTML: (attrs) => ({ "data-src-start": String(attrs.srcStart) }),
      },
      srcEnd: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-src-end") ?? 0),
        renderHTML: (attrs) => ({ "data-src-end": String(attrs.srcEnd) }),
      },
      duration: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-duration") ?? 0),
        renderHTML: (attrs) => ({ "data-duration": String(attrs.duration) }),
      },
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
        class: "pause-marker",
        contenteditable: "false",
        title: `${label} pause — click or press Delete to remove`,
      }),
      label,
    ];
  },

  addKeyboardShortcuts() {
    const dispatchDelete = (attrs: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent("yusafcut:delete-pause", {
          detail: { pauseId: attrs.pauseId },
        }),
      );
      return true;
    };

    return {
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        if (!selection.empty) return false;
        const node = editor.state.doc.nodeAt(selection.from - 1);
        if (node?.type.name === "pause") {
          return dispatchDelete(node.attrs);
        }
        return false;
      },
      Delete: ({ editor }) => {
        const { selection } = editor.state;
        if (!selection.empty) return false;
        const node = editor.state.doc.nodeAt(selection.from);
        if (node?.type.name === "pause") {
          return dispatchDelete(node.attrs);
        }
        return false;
      },
    };
  },
});
