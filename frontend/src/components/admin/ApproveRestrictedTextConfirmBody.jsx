import React from "react";

// Shared by every place an admin approves a restricted partner's exact
// text to send/save as-is: the creation-time "approve now" checkbox, the
// Pending Notifications page's Quick Approve, and NotificationReviewModal's
// own Save and Approve. All three used to carry their own near-identical
// window.confirm string (same warning, same masking guarantee, same
// quoted text, differing only in which verb their own flow used) --
// renamed from the creation-only ApproveNowConfirmBody once it became
// clear "now" only described one of the three callers. The
// flow-specific verb ("approve and save" vs. "approve and send") belongs
// in the caller's own confirm({ title, confirmLabel }), not here.
export default function ApproveRestrictedTextConfirmBody({ text }) {
  return (
    <div>
      <p style={{ marginTop: 0 }}>
        This partner is restricted. Approving marks this reviewed and eligible to send to any enabled
        notification channel -- their name, photo, and any source-file link stay masked regardless, but
        the exact wording below is what's sent.
      </p>
      <p>
        Check it for anything else that could identify them or their location (a specific place, date,
        or detail only they'd be tied to) before approving.
      </p>
      <blockquote
        style={{
          margin: "0.75rem 0 0",
          padding: "0.6rem 0.9rem",
          borderLeft: "3px solid #999",
          background: "#f7f7f5",
          fontStyle: "italic",
          color: "#333",
        }}
      >
        "{text}"
      </blockquote>
    </div>
  );
}
