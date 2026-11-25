import React from "react";

// A label+value pair for read-only views (EditableSection `view` renderers, the viewer-role Modal
// fallback). `showEmpty: false` (default) hides the field when empty; `true` shows "—".
export default function Field({ label, value, showEmpty = false }) {
  const isEmpty = value === null || value === undefined || value === "";
  if (isEmpty && !showEmpty) return null;
  // minWidth: 0 and overflowWrap: a long unbreakable value (an email address, a URL) wraps
  // instead of pushing the page wider than a phone screen.
  return (
    <div className="field-view" style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </div>
      <div style={{ overflowWrap: "anywhere", ...(isEmpty ? { color: "var(--muted)" } : null) }}>
        {isEmpty ? "—" : value}
      </div>
    </div>
  );
}
