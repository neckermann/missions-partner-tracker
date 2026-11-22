import { useEffect, useState } from "react";
import { fetchCurrentUser } from "../api/client.js";

// The one place every page gets its role-derived permission flags from,
// instead of each page independently calling fetchCurrentUser() and
// recomputing the same "admin or editor" check. Exposes primitives only --
// `canWrite` (admin or editor -- true everywhere a write is possible) and
// `isAdmin` -- deliberately not a single `canDelete`, because delete
// permission genuinely varies by resource (see the role-gating table in
// the app-wide CRUD unification plan): most resources are admin-only to
// delete, but Trip Meetings/Requirements/Budget Lines/Flight Segments/
// Documents/Contributions/Participants and Pending Dispatches allow
// editor-delete too. Each call site combines canWrite/isAdmin per its own
// resource's real backend rule.
export default function useCurrentUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser().then((u) => {
      if (!cancelled) {
        setUser(u);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const canWrite = user?.role === "admin" || user?.role === "editor";
  const isAdmin = user?.role === "admin";

  return { user, loading, canWrite, isAdmin };
}
