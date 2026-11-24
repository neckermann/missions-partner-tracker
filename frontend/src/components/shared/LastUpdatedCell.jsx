import React from "react";
import { formatDate } from "../../utils/format.js";

// A list cell for "when was this record (or anything on its page) last changed,
// and by whom" (#341). Blank for a record no signed-in person has changed (made
// by a job, the seed or a public form). The list column is hidden from guests,
// whose lists carry no editor names.
export default function LastUpdatedCell({ at, name }) {
  if (!at) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <>
      {/* A touch smaller than the other cells: this column is added to lists whose
          table already fills its width, and the date sets its width. */}
      <span style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>{formatDate(at)}</span>
      {name && <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>by {name}</div>}
    </>
  );
}

// Sort key for a "Last updated" column: newest first when descending, blanks last.
export const lastUpdatedSortKey = (at) => (at ? new Date(at).getTime() : null);
