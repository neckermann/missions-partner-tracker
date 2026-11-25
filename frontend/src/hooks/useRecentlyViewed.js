import { useEffect } from "react";

// Backs AdminHome.jsx's "Recently viewed" row -- a pure per-browser
// convenience (not synced anywhere, not read back by any other page),
// so localStorage is the right place for it: nothing breaks if it's
// empty, cleared, or disagrees between two of an admin's own devices.
const STORAGE_KEY = "admin.recentlyViewed";
const MAX_ENTRIES = 8;

function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private-window/blocked-storage -- recently-viewed is a convenience,
    // not a feature anything depends on, so this just silently no-ops.
  }
}

// Call from a detail page once its record has loaded, e.g.:
//   useRecordRecentlyViewed(p && { to: `/admin/partners/${p.id}`, label: p.displayName, kind: "Partner" })
// Pass a falsy value (record not loaded yet) and it's a no-op.
export function useRecordRecentlyViewed(entry) {
  // The three fields it records, not the entry object: callers build a new object every
  // render, which would otherwise rewrite the list on every render.
  const to = entry?.to;
  const label = entry?.label;
  const kind = entry?.kind;
  useEffect(() => {
    if (!to) return;
    const existing = read().filter((e) => e.to !== to);
    write([{ to, label, kind, viewedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES));
  }, [to, label, kind]);
}

// Call from AdminHome.jsx to render the row. Not reactive to other tabs/
// windows changing it -- read once per Home visit is enough for what
// this is.
export function getRecentlyViewed() {
  return read();
}
