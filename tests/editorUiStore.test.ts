import { describe, it, expect, beforeEach } from "vitest";
import { useEditorUiStore } from "@/stores/editorUiStore";

describe("editorUiStore", () => {
  beforeEach(() => {
    useEditorUiStore.setState({
      activeRightPanel: "main",
      inspectorOpen: true,
      findOpen: false,
      aspectRatio: "16:9",
      previewZoom: 1,
      autoZoomEnabled: true,
    });
  });

  it("starts with main panel active and inspector open", () => {
    const { activeRightPanel, inspectorOpen } = useEditorUiStore.getState();
    expect(activeRightPanel).toBe("main");
    expect(inspectorOpen).toBe(true);
  });

  it("setActiveRightPanel on the already-active panel toggles inspector closed", () => {
    useEditorUiStore.getState().setActiveRightPanel("main"); // already active
    expect(useEditorUiStore.getState().inspectorOpen).toBe(false);
  });

  it("setActiveRightPanel on active-but-closed panel reopens inspector", () => {
    useEditorUiStore.setState({ inspectorOpen: false });
    useEditorUiStore.getState().setActiveRightPanel("main"); // active + closed
    expect(useEditorUiStore.getState().inspectorOpen).toBe(true);
  });

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
