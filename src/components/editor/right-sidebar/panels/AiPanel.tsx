export function AiPanel() {
  return (
    <div className="inspector-panel-content">
      <div className="inspector-section">
        <p className="inspector-section-label">Prompt</p>
        <textarea
          disabled
          placeholder="Describe what you want to do…"
          style={{
            width: "100%",
            minHeight: 72,
            resize: "vertical",
            borderRadius: 6,
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--secondary))",
            color: "hsl(var(--muted-foreground))",
            padding: "8px 10px",
            fontSize: 12,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        />
      </div>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <p className="inspector-section-label">Quick actions</p>
        {[
          "Remove filler words",
          "Cut to 60 seconds",
          "Remove silence",
          "Find quote",
          "Summarise chapters",
        ].map((action) => (
          <button
            key={action}
            className="inspector-segmented-btn"
            style={{ height: 30, textAlign: "left", paddingLeft: 10, marginBottom: 4, borderRadius: 5, border: "1px solid hsl(var(--border))" }}
            disabled
          >
            {action}
          </button>
        ))}
        <p className="inspector-hint">
          AI suggestions must be reviewed before applying edits.
        </p>
      </div>
    </div>
  );
}
