import React from "react";

// The care-team counterpart of ApproveRestrictedTextConfirmBody: shown when staff approve an item a
// care team member entered. Nothing a non-staff login enters is sent before staff read it. Quotes
// the exact wording that will go out as the final checkpoint.
export default function ApproveCareTeamTextConfirmBody({ text }) {
  return (
    <div>
      <p style={{ marginTop: 0 }}>
        A care team member entered this. Approving lets it go out in your chat posts and update emails (and
        the public prayer digest, if you use it), with exactly the wording below.
      </p>
      <p>Read it over first: once it has gone out it can't be taken back.</p>
      <blockquote
        style={{
          margin: "0.75rem 0 0",
          padding: "0.6rem 0.9rem",
          borderLeft: "3px solid var(--muted)",
          background: "var(--surface-2)",
          fontStyle: "italic",
          color: "var(--text)",
        }}
      >
        "{text}"
      </blockquote>
    </div>
  );
}
