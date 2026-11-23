import { useCallback, useEffect, useState } from "react";

// Light/dark/system appearance (#283).
//
// "system" means no override at all -- index.css's own
// `@media (prefers-color-scheme: dark)` block decides, same as any site
// that's never touched this. "light"/"dark" pin it regardless of the OS
// setting by writing a `data-theme` attribute onto <html>, which index.css's
// `:root[data-theme="dark"]` rule (and `:not([data-theme="light"])` on the
// media-query block) is written to respect. Per-browser only: localStorage,
// not a User field or a ChurchSettings toggle -- see the issue for why.
export const THEME_STORAGE_KEY = "admin.theme";
export const THEME_OPTIONS = ["system", "light", "dark"];

function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_OPTIONS.includes(stored) ? stored : "system";
  } catch {
    // localStorage can throw (private browsing, blocked storage, ...) --
    // fall back to "system" rather than let the whole page fail to render.
    return "system";
  }
}

// Applies the given theme to the document -- exported separately from the
// hook so index.html's own pre-paint inline script (see that file) and this
// hook apply the exact same rule, instead of two copies drifting apart.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
}

// One hook, shared by every ThemeToggle instance (the one on Account
// Settings, and optionally one in the sidebar) -- each reads/writes the
// same localStorage key, so changing it in one place is reflected
// immediately in the other without a page reload, the same way
// useSettings() keeps every page in sync with ChurchSettings.
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
      // Storage being unavailable shouldn't block the theme from applying
      // for the rest of this tab's session -- it just won't persist.
    }
  }, []);

  return [theme, setTheme];
}
