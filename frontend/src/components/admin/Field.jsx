import React from "react";
import CopyValue from "../shared/CopyValue.jsx";

// A label+value pair for read-only views (EditableSection `view` renderers, the viewer-role Modal
// fallback). `showEmpty: false` (default) hides the field when empty; `true` shows "—".
// `copy` ("phone" or "email") puts a copy button beside the value (shared/CopyValue.jsx); `whose` names whose it is
// for the button's label. Leave it off wherever the value may be withheld.
export default function Field({ label, value, showEmpty = false, copy, whose }) {
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
        {isEmpty ? (
          "—"
        ) : copy ? (
          <CopyValue kind={copy} value={String(value)} whose={whose}>
            {value}
          </CopyValue>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
