import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PANEL, useEditorUiStore } from "@/stores/editorUiStore";

describe("editorUiStore", () => {
  beforeEach(() => {
    useEditorUiStore.setState({
      workspaceMode: "edit",
      activePanel: DEFAULT_PANEL.edit,
      inspectorOpen: true,
      findOpen: false,
      aspectRatio: "16:9",
      previewZoom: 1,
      autoZoomEnabled: true,
    });
  });

  describe("workspace modes", () => {
    it("switching mode resets the active panel to that mode's default and opens the inspector", () => {
      useEditorUiStore.setState({ inspectorOpen: false, activePanel: "export" });
      useEditorUiStore.getState().setWorkspaceMode("transcribe");
      const s = useEditorUiStore.getState();
      expect(s.workspaceMode).toBe("transcribe");
      expect(s.activePanel).toBe(DEFAULT_PANEL.transcribe);
      expect(s.inspectorOpen).toBe(true);
    });

    it("setting the same mode is a no-op (keeps panel and inspector state)", () => {
      useEditorUiStore.setState({ activePanel: "export", inspectorOpen: false });
      useEditorUiStore.getState().setWorkspaceMode("edit");
      const s = useEditorUiStore.getState();
      expect(s.activePanel).toBe("export");
      expect(s.inspectorOpen).toBe(false);
    });
  });

  describe("panels", () => {
    it("clicking the active panel toggles the inspector", () => {
      useEditorUiStore.getState().setActivePanel(DEFAULT_PANEL.edit);
      expect(useEditorUiStore.getState().inspectorOpen).toBe(false);
      useEditorUiStore.getState().setActivePanel(DEFAULT_PANEL.edit);
      expect(useEditorUiStore.getState().inspectorOpen).toBe(true);
    });

    it("clicking a different panel activates it and opens the inspector", () => {
      useEditorUiStore.setState({ inspectorOpen: false });
      useEditorUiStore.getState().setActivePanel("export");
      const s = useEditorUiStore.getState();
      expect(s.activePanel).toBe("export");
      expect(s.inspectorOpen).toBe(true);
    });
  });

  describe("misc ui state", () => {
    it("setFindOpen sets findOpen to true", () => {
      useEditorUiStore.getState().setFindOpen(true);
      expect(useEditorUiStore.getState().findOpen).toBe(true);
    });

    it("setFindOpen sets findOpen to false", () => {
      useEditorUiStore.setState({ findOpen: true });
      useEditorUiStore.getState().setFindOpen(false);
      expect(useEditorUiStore.getState().findOpen).toBe(false);
    });

    it("setPreviewZoom updates previewZoom", () => {
      useEditorUiStore.getState().setPreviewZoom(0.75);
      expect(useEditorUiStore.getState().previewZoom).toBe(0.75);
    });

    it("setAspectRatio updates aspectRatio", () => {
      useEditorUiStore.getState().setAspectRatio("9:16");
      expect(useEditorUiStore.getState().aspectRatio).toBe("9:16");
    });
  });
});
