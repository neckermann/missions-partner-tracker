import React from "react";

// Generic color+label pill -- the one rendering primitive both
// TripStatusBadge (a Trip's own lifecycle status) and the former
// AdminTripPlanning.jsx's local KindBadge (open/committed/no-trip-
// scheduled) duplicated independently. Neither of those concepts
// disappears -- they still pick their own color/label per value -- only
// the markup that turns a color+label into a pill is shared now.
//
// Dark mode (#283): every call site hardcodes its own `color` (a status/
// kind lookup table living next to that value, per STYLE-GUIDE.md), and
// there are dozens of them across the app -- auditing each one for its own
// light/dark pair wasn't going to happen. Instead this one component
// blends that raw color toward the current theme's own text/surface
// tokens with color-mix(): the foreground moves toward --text and the
// background toward --surface-2, in whatever proportion keeps the color
// identifiable without just being `${color}1a` (a fixed-alpha tint that
// used to assume a light page behind it -- on a dark page that same alpha
// math landed a dark tint under already-dark text, i.e. unreadable).
// Every existing caller's hardcoded hex therefore becomes theme-safe for
// free, with no change at any call site.
export default function StatusPill({ label, color = "#6b6f76" }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.7rem",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        color: `color-mix(in srgb, ${color} 65%, var(--text))`,
        background: `color-mix(in srgb, ${color} 18%, var(--surface-2))`,
      }}
    >
      {label}
    </span>
  );
}
