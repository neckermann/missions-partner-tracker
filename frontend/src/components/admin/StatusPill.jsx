import React from "react";

// Generic color+label pill -- the one rendering primitive both
// TripStatusBadge (a Trip's own lifecycle status) and the former
// AdminTripPlanning.jsx's local KindBadge (open/committed/no-trip-
// scheduled) duplicated independently. Neither of those concepts
// disappears -- they still pick their own color/label per value -- only
// the markup that turns a color+label into a pill is shared now.
export default function StatusPill({ label, color = "#6b6f76" }) {
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
