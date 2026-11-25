import React from "react";

// The plain-message body for an ordinary confirm (a delete, discard, archive). Use
// UrgentSendConfirmBody/ApproveRestrictedTextConfirmBody for structured content.
export default function ConfirmMessageBody({ children }) {
  return <p style={{ margin: 0 }}>{children}</p>;
}
