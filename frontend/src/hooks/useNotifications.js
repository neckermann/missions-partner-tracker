import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { fetchNotificationSummary, markNotificationSeen } from "../api/client.js";

// Refresh on nav/focus plus an interval poll paused while the tab is hidden. Deliberately not
// websockets/push: forks are self-hosted on modest hosting, and a persistent connection adds
// operational surface (proxy timeouts, reconnects) for a need that tolerates a couple of minutes.
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
