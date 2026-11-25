import React from "react";
import { formatDate } from "../../utils/format.js";

// "Last edited by Dana Whitfield on 11/24/2026". Who last changed a record is a current-state fact
// kept on the record (the name is a snapshot, so it survives the account being deleted) and, unlike
// the Audit log, never expires. Renders nothing for a record no signed-in person has changed
// (job, seed, public form). Takes name and at, and optionally createdAt for "Added ...".
export default function LastEdited({ name, at, createdAt, style }) {
  const edited = name && at ? `Last edited by ${name} on ${formatDate(at)}` : null;
  // When the record was added, if the page has it: "Added 11/10/2026 · Last edited by ...".
  const added = createdAt ? `Added ${formatDate(createdAt)}` : null;
  if (!edited && !added) return null;
  return (
    <p
      className="last-edited"
      style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0", ...style }}
    >
      {[added, edited].filter(Boolean).join(" · ")}
    </p>
  );
}
