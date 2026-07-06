import { describe, expect, it } from "vitest";
import { PANELS, panelsForMode } from "@/components/editor/sidebar/registry";
import { DEFAULT_PANEL } from "@/stores/editorUiStore";

describe("panel registry", () => {
  it("has unique panel ids", () => {
    const ids = PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters panels by workspace mode", () => {
    for (const p of panelsForMode("transcribe")) expect(p.modes).toContain("transcribe");
    for (const p of panelsForMode("edit")) expect(p.modes).toContain("edit");
  });

  it("exposes the expected panels per mode", () => {
    expect(panelsForMode("transcribe").map((p) => p.id)).toEqual(["media", "transcribe"]);
    expect(panelsForMode("edit").map((p) => p.id)).toEqual(["edit-tools", "music", "export"]);
  });

  it("each mode's default panel exists in that mode", () => {
    expect(panelsForMode("transcribe").some((p) => p.id === DEFAULT_PANEL.transcribe)).toBe(true);
    expect(panelsForMode("edit").some((p) => p.id === DEFAULT_PANEL.edit)).toBe(true);
  });
});
