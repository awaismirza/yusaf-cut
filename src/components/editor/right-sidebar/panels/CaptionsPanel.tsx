export function CaptionsPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Captions</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Style</p>
        <div className="inspector-segmented">
          {["Clean", "Bold", "Subtitle", "Social"].map((s) => (
            <button key={s} className="inspector-segmented-btn" disabled>
              {s}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Caption rendering coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Export</p>
        <button
          className="inspector-segmented-btn"
          style={{ height: 30, width: "100%", borderRadius: 5, border: "1px solid hsl(var(--border))" }}
          onClick={() => window.dispatchEvent(new CustomEvent("yusafcut:export-captions"))}
        >
          Export SRT / VTT
        </button>
      </div>
    </div>
  );
}
