import React from "react";

// Generic color+label pill shared by TripStatusBadge and the other status/kind badges. Call sites
// hardcode their own `color`, so the pill blends it toward the theme's --text (foreground) and
// --surface-2 (background) with color-mix(): a fixed-alpha tint assumed a light page and was
// unreadable on dark. Every caller's hex is theme-safe without changes.
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
