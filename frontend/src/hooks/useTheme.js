import { useCallback, useEffect, useState } from "react";

// Light/dark/system appearance. "system" means no override: index.css's prefers-color-scheme
// block decides. "light"/"dark" pin it via a `data-theme` attribute on <html>. Per-browser only
// (localStorage), not a User or ChurchSettings field.
export const THEME_STORAGE_KEY = "admin.theme";
export const THEME_OPTIONS = ["system", "light", "dark"];

function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_OPTIONS.includes(stored) ? stored : "system";
  } catch {
    // localStorage can throw (private browsing, blocked storage): fall back to "system".
    return "system";
  }
}

// Exported separately so index.html's pre-paint inline script and this hook apply the same rule.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
}

// Shared by every ThemeToggle instance; they read/write the same localStorage key.
export default function useTheme() {
  const [theme, setThemeState] = useState(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEME_OPTIONS.includes(next)) return;
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Unavailable storage shouldn't block applying the theme; it just won't persist.
    }
  }, []);

  return [theme, setTheme];
}
