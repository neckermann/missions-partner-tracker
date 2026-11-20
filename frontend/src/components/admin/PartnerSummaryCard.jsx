import React from "react";
import { Link } from "react-router-dom";

// A lightweight stand-in for a full embedded CRUD widget on Partner
// Detail, for a collection that already has its own real, filterable
// admin page elsewhere (Monthly Support, One-Time Needs, Trips, Prayer
// Requests, Newsletters & Docs) -- managing those moves entirely to that
// page, pre-filtered to this partner via "View all", instead of this page
// carrying a second copy of the same add/edit form.
export default function PartnerSummaryCard({ icon, title, count, summary, viewAllTo }) {
  return (
    <div className="admin-section partner-summary-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <Link to={viewAllTo} className="btn secondary small">
          View all →
        </Link>
      </div>
      <p style={{ margin: "0.5rem 0 0", color: "#555" }}>
        {count === 0 ? "None on file." : `${count} on file`}
        {count > 0 && summary ? ` · ${summary}` : ""}
      </p>
    </div>
  );
}
