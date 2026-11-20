import React from "react";
import { Link } from "react-router-dom";

// A lightweight stand-in for a full embedded CRUD widget on Partner
// Detail, for a collection that already has its own real, filterable
// admin page elsewhere (Monthly Support, One-Time Needs, Trips, Prayer
// Requests, Newsletters & Docs) -- managing those moves entirely to that
// page, pre-filtered to this partner via "View all". `actions` (e.g.
// "+ Add", "Mark Answered") open the real add/edit forms in a quick popup
// right here instead -- see QuickActionModal.jsx -- so this still isn't a
// second copy of those forms, just a faster way to reach the same ones.
export default function PartnerSummaryCard({ icon, title, count, summary, viewAllTo, actions }) {
  return (
    <div className="admin-section partner-summary-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {actions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className="btn secondary small"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
          <Link to={viewAllTo} className="btn secondary small">
            View all →
          </Link>
        </div>
      </div>
      <p style={{ margin: "0.5rem 0 0", color: "#555" }}>
        {count === 0 ? "None on file." : `${count} on file`}
        {count > 0 && summary ? ` · ${summary}` : ""}
      </p>
    </div>
  );
}
