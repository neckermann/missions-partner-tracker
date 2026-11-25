import { useEffect } from "react";

// Backs AdminHome's "Recently viewed" row: a per-browser convenience, so localStorage is right and
// nothing breaks if it is empty, cleared, or differs between devices.
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
    // Private-window/blocked storage: recently-viewed is a convenience, so this silently no-ops.
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

// Read once per Home visit; not reactive to other tabs.
export function getRecentlyViewed() {
  return read();
}
