export function CropPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Crop</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
        {["Top", "Bottom", "Left", "Right"].map((side) => (
          <div key={side} className="inspector-row">
            <span className="inspector-row-label">{side}</span>
            <span className="inspector-row-value">0 px</span>
          </div>
        ))}
        <p className="inspector-hint">Crop controls coming soon.</p>
      </div>
    </div>
  );
}
