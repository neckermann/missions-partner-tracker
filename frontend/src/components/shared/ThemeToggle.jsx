import React from "react";
import useTheme, { THEME_OPTIONS } from "../../hooks/useTheme.js";

const LABELS = { system: "System", light: "Light", dark: "Dark" };

// System/Light/Dark segmented control (#283) -- same seg-btn pattern as the
// design-reference mockup's own "Appearance" control. Lives on Account
// Settings (the obvious home for a personal, per-browser preference) and
// is re-rendered in the sidebar footer for one-click access without a trip
// to Account Settings -- both instances share the same useTheme() state via
// localStorage, so either one reflects a change made in the other on next
// mount.
export default function ThemeToggle({ compact = false }) {
  const [theme, setTheme] = useTheme();

  return (
    <div
      className={compact ? "theme-toggle theme-toggle-compact" : "theme-toggle"}
      role="group"
      aria-label="Appearance"
    >
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          className={opt === theme ? "theme-toggle-btn active" : "theme-toggle-btn"}
          aria-pressed={opt === theme}
          onClick={() => setTheme(opt)}
        >
          {LABELS[opt]}
        </button>
      ))}
    </div>
  );
}
