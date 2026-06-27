export function MaskPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Mask</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
        <p className="inspector-section-label" style={{ marginTop: 4 }}>Shape</p>
        <div className="inspector-segmented">
          {["Rectangle", "Circle", "Blur area"].map((s) => (
            <button key={s} className="inspector-segmented-btn" disabled>
              {s}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Mask controls coming soon.</p>
      </div>
    </div>
  );
}
