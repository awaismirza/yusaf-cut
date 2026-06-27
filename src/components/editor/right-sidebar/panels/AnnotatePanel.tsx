export function AnnotatePanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Add annotation</p>
        {["Arrow", "Rectangle", "Text", "Highlight"].map((tool) => (
          <button
            key={tool}
            className="inspector-segmented-btn"
            style={{ height: 30, textAlign: "left", paddingLeft: 10, marginBottom: 4, borderRadius: 5, border: "1px solid hsl(var(--border))" }}
            disabled
          >
            {tool}
          </button>
        ))}
        <p className="inspector-hint">Annotation tools coming soon.</p>
      </div>
    </div>
  );
}
