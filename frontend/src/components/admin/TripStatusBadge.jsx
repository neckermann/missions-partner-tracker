import React from "react";
import StatusPill from "./StatusPill.jsx";

// Shared between the Trips list (its "Existing Trips" tab) and
// AdminTripDetail.jsx (a single trip's own header) -- extracted so both
// show the same label/color for a given status instead of one of them
// drifting out of sync, and so a status never renders as its raw
// snake_case value (that happened on AdminTripDetail.jsx's header until
// this was added). Delegates its actual rendering to the generic
// StatusPill now, same as the trip-planning "kind" pill does -- this
// file stays just the status->color/label lookup table.
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
  return <StatusPill label={STATUS_LABELS[status] || status} color={STATUS_COLORS[status]} />;
}
