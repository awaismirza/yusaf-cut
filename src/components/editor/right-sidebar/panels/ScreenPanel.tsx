export function ScreenPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Transform</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Scale</span>
          <span className="inspector-row-value">100%</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Position X</span>
          <span className="inspector-row-value">—</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Position Y</span>
          <span className="inspector-row-value">—</span>
        </div>
        <p className="inspector-hint">Screen transform controls coming soon.</p>
      </div>
    </div>
  );
}
