import { useEditorUiStore } from "@/stores/editorUiStore";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3"] as const;
const PRESETS = ["YouTube 1080p", "Shorts / TikTok", "Square post", "Podcast clip"] as const;
const FIT_MODES = ["Fit", "Fill", "100%"] as const;

export function LayoutPanel() {
  const aspectRatio = useEditorUiStore((s) => s.aspectRatio);
  const setAspectRatio = useEditorUiStore((s) => s.setAspectRatio);
  const autoZoomEnabled = useEditorUiStore((s) => s.autoZoomEnabled);
  const setAutoZoomEnabled = useEditorUiStore((s) => s.setAutoZoomEnabled);
  const previewZoom = useEditorUiStore((s) => s.previewZoom);

  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Canvas</p>
        <div className="inspector-segmented">
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar}
              className={`inspector-segmented-btn${aspectRatio === ar ? " is-active" : ""}`}
              onClick={() => setAspectRatio(ar)}
            >
              {ar}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Presets</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className="inspector-segmented-btn"
              style={{ height: 30, textAlign: "left", paddingLeft: 10 }}
              disabled
            >
              {p}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Preset application coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Preview fit</p>
        <div className="inspector-segmented">
          {FIT_MODES.map((m) => (
            <button key={m} className="inspector-segmented-btn" disabled>
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Auto zoom</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Auto fit</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={autoZoomEnabled}
              onChange={(e) => setAutoZoomEnabled(e.target.checked)}
            />
            <span className="inspector-hint" style={{ margin: 0 }}>
              {autoZoomEnabled ? "On" : "Off"}
            </span>
          </label>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Zoom</span>
          <span className="inspector-row-value">{Math.round(previewZoom * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
