import React from "react";
import useTheme, { THEME_OPTIONS } from "../../hooks/useTheme.js";

const LABELS = { system: "System", light: "Light", dark: "Dark" };

// System/Light/Dark segmented control, on Account Settings and in the sidebar footer. Both share
// useTheme() state via localStorage, so a change in one shows in the other on next mount.
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
