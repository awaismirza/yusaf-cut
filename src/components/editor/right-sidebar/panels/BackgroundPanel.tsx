export function BackgroundPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Wallpaper</p>
        <div className="inspector-segmented">
          {["Wallpaper", "Gradient", "Color", "Image"].map((t) => (
            <button key={t} className="inspector-segmented-btn" disabled>
              {t}
            </button>
          ))}
        </div>
        <p className="inspector-hint">Background controls coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Screen</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Padding</span>
          <span className="inspector-row-value">—</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Corners</span>
          <span className="inspector-row-value">—</span>
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Depth</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Shadow</span>
          <span className="inspector-row-value">—</span>
        </div>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Device frame</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Enabled</span>
          <input type="checkbox" disabled />
        </div>
        <p className="inspector-hint">Device frame coming soon.</p>
      </div>
    </div>
  );
}
