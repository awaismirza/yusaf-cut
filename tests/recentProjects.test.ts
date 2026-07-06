import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRecentProject, getRecentProjects } from "@/lib/recentProjects";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("recentProjects", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("returns empty list when nothing stored", () => {
    expect(getRecentProjects()).toEqual([]);
  });

  it("adds most-recent first and dedupes", () => {
    addRecentProject("/a.scribe");
    addRecentProject("/b.scribe");
    addRecentProject("/a.scribe");
    expect(getRecentProjects()).toEqual(["/a.scribe", "/b.scribe"]);
  });

  it("caps the list at 5 entries", () => {
    for (const p of ["/1", "/2", "/3", "/4", "/5", "/6"]) addRecentProject(p);
    expect(getRecentProjects()).toEqual(["/6", "/5", "/4", "/3", "/2"]);
  });

  it("survives corrupted storage", () => {
    localStorage.setItem("yusafcut.recentProjects", "{not json");
    expect(getRecentProjects()).toEqual([]);
  });
});
