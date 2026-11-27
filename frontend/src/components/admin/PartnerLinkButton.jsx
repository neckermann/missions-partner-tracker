import React from "react";
import { Link } from "react-router-dom";

// The way from a record's window (a prayer request, a one-time need, a partner file) to the partner it belongs to.
// A button-styled link like the app's other navigation actions (still a real link: open in a new tab, copy the
// address), named for where it goes ("Go to Abernathy family") when the partner is in `partners`, else "Go to
// partner". The name comes from the same list the window's own partner picker uses, so it is what signed-in staff
// already see there. One component for all three windows so they cannot drift apart.
export default function PartnerLinkButton({ partnerId, partners = [] }) {
  if (!partnerId) return null;
  const name = partners.find((p) => p.id === partnerId)?.displayName;
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <Link className="btn secondary small" to={`/admin/partners/${partnerId}`}>
        {name ? `Go to ${name}` : "Go to partner"} →
      </Link>
    </div>
  );
}
