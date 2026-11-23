import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { fetchNotificationSummary, markNotificationSeen } from "../api/client.js";

// Refresh on nav/focus, plus a lightweight interval poll while the tab is
// actually visible -- paused via document.visibilityState when
// backgrounded. Deliberately not websockets/push: this app is forked and
// self-hosted by individual churches on modest hosting, and a persistent
// connection would add real operational surface (reverse-proxy timeout
// tuning, reconnect handling) every forking church inherits, for a need
// that doesn't require faster than "within a couple minutes." See the
// in-app notifications plan's own Architecture section for the full
// reasoning.
const POLL_MS = 90 * 1000;

export default function useNotifications() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    fetchNotificationSummary()
      .then((data) => {
        if (mountedRef.current) setCategories(data);
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Nav.
  useEffect(() => {
    refresh();
  }, [location.pathname, refresh]);

  // Focus.
  useEffect(() => {
    function onFocus() {
      refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Paused-when-hidden interval poll.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const totalUnread = categories.filter((c) => c.isNew && c.count > 0).length;

  async function markSeen(category) {
    await markNotificationSeen(category).catch(() => {});
    refresh();
  }

  return { categories, loading, totalUnread, refresh, markSeen };
}
