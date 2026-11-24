import React from "react";
import { formatDate } from "../../utils/format.js";

// "Last edited by Dana Whitfield on 11/24/2026" (#341). Who last changed a
// record is a current-state fact kept on the record itself (the name is a
// snapshot, so it still reads after that account is deleted) -- unlike the
// Audit log's event history, it never expires. Renders nothing for a record
// no signed-in person has changed (created by a job, the seed or a public
// form), so there is no empty "last edited by" line. Takes the two fields
// explicitly (name, at) -- a page passes lastEditedByName / lastEditedAt -- and,
// optionally, createdAt, so a trip's page can also say when it was added.
export default function LastEdited({ name, at, createdAt, style }) {
  const edited = name && at ? `Last edited by ${name} on ${formatDate(at)}` : null;
  // When the record was added (#383), where the page has one: "Added 11/10/2026 · Last edited by ...".
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
