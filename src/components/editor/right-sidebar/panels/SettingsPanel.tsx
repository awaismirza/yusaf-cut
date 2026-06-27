export function SettingsPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Editor</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Cut padding</span>
          <span className="inspector-row-value">—</span>
        </div>
        <p className="inspector-hint">Cut padding and editor settings coming soon.</p>
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Storage</p>
        <div className="inspector-row">
          <span className="inspector-row-label">Model storage</span>
          <span className="inspector-row-value">—</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-row-label">Cache</span>
          <span className="inspector-row-value">—</span>
        </div>
      </div>
    </div>
  );
}
