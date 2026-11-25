import React from "react";

// Shared by every place an admin approves a restricted partner's exact text: the creation-time
// "approve now" checkbox, Pending Dispatches' Quick Approve, and DispatchReviewModal's Save and
// Approve. The flow-specific verb belongs in the caller's confirm({ title, confirmLabel }).
export default function ApproveRestrictedTextConfirmBody({ text }) {
  return (
    <div>
      <p style={{ marginTop: 0 }}>
        This partner is restricted. Approving marks this reviewed and eligible to send to any enabled dispatch
        channel -- their name, photo, and any source-file link stay masked regardless, but the exact wording
        below is what's sent.
      </p>
      <p>
        Check it for anything else that could identify them or their location (a specific place, date, or
        detail only they'd be tied to) before approving.
      </p>
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
