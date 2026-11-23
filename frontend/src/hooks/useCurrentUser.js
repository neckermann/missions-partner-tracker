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
  // Trip Leader guest tier -- a scoped guest with editor-equivalent write
  // access to exactly their own trip's own content (never reflected in
  // canWrite above, which is global), read-only elsewhere. Pages inside
  // that one trip's own subtree (TripDetailLayout.jsx) combine this with
  // their own scope check rather than trusting canWrite directly.
  const isTripLeader = user?.role === "tripLeader";
  const scopedTripId = user?.scopedTripId ?? null;
  const scopedTrip = user?.scopedTrip ?? null;

  return { user, loading, canWrite, isAdmin, isTripLeader, scopedTripId, scopedTrip };
}
