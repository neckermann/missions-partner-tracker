import React from "react";

// A label+value pair for a read-only view -- used by EditableSection's own
// `view` renderers (AdminPartnerDetail.jsx) and by the read-only Modal
// fallback every click-to-detail popup shows a viewer-role (non-admin/
// editor) user. `showEmpty: false` (the default) hides the whole field
// when there's nothing to show, so an edit-only field doesn't leave a
// blank line in a view that's mostly populated; `showEmpty: true` is for
// a field that's always relevant enough to show as "—" instead of
// disappearing.
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
