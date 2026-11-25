import React from "react";

// The care-team counterpart of ApproveRestrictedTextConfirmBody (#289): shown
// when an admin/editor approves an item a care team member entered. It's held
// out of every channel until reviewed -- not because the partner is restricted,
// but because nothing a non-staff login enters is sent before someone on staff
// has read it. Same shape as the restricted version: the exact wording that
// will go out, quoted, as the final checkpoint.
export default function ApproveCareTeamTextConfirmBody({ text }) {
  return (
    <div>
      <p style={{ marginTop: 0 }}>
        A care team member entered this. Approving marks it reviewed and eligible to send to any enabled
        dispatch channel, with exactly the wording below.
      </p>
      <p>Read it over first: it goes to the whole congregation, not just the team.</p>
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
