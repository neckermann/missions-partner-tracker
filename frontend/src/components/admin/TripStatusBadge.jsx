import React from "react";
import StatusPill from "./StatusPill.jsx";

// The status->color/label lookup shared by the Trips list and TripDetailLayout, so a status never
// renders as raw snake_case. Rendering is delegated to StatusPill.
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
