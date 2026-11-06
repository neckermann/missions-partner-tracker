import React from "react";

// The plain-message body for an ordinary confirm (a delete, a discard, an
// archive) -- just a paragraph, styled consistently wherever one of these
// appears instead of each call site hand-rolling its own <p>. Reach for
// UrgentSendConfirmBody/ApproveRestrictedTextConfirmBody instead when the
// dialog needs to show structured content (a recipient list, a quoted
// block of text); this is for the common case that's really just a
// sentence.
export default function ConfirmMessageBody({ children }) {
  return <p style={{ margin: 0 }}>{children}</p>;
}
