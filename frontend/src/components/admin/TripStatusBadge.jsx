import React from "react";

// Shared between AdminTrips.jsx (the ledger list) and AdminTripDetail.jsx
// (a single trip's own header) -- extracted so both show the same label/
// color for a given status instead of one of them drifting out of sync,
// and so a status never renders as its raw snake_case value (that
// happened on AdminTripDetail.jsx's header until this was added).
export const STATUS_LABELS = {
  planning: "Planning",
  accepting_applications: "Accepting applications",
  closed: "Closed (team set)",
  completed: "Completed",
};
const STATUS_COLORS = {
  planning: "#a6540f",
  accepting_applications: "#1f6b4f",
  closed: "#2a5d8f",
  completed: "#6b6f76",
};

export default function TripStatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  const color = STATUS_COLORS[status] || "#6b6f76";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.7rem",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        color,
        background: `${color}1a`,
      }}
    >
      {label}
    </span>
  );
}
