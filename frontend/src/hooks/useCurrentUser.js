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
  // Guest tier (#356): a scoped login whose reach is exactly its grants --
  // editor-equivalent write access to each trip it was granted (never
  // reflected in canWrite above, which is global), read-only on those
  // trips' partners, nothing else. Pages inside a trip's subtree
  // (TripDetailLayout.jsx) combine canAccessTrip with their own check
  // rather than trusting canWrite directly. guestTrips comes from /me:
  // [{ id, label, partnerId, partnerLabel, expiresAt }] for each grant
  // that is active right now.
  const isGuest = user?.role === "guest";
  const guestTrips = isGuest ? (user?.guestTrips ?? []) : [];
  const guestTripIds = guestTrips.map((t) => t.id);
  // Every trip a guest may open: their granted trips (editable) plus, via a
  // care team seat, their partner's trips (view only).
  const guestReadTripIds = isGuest ? (user?.guestReadTripIds ?? guestTripIds) : [];
  const canAccessTrip = (tripId) => isGuest && !!tripId && guestTripIds.includes(tripId);

  // Care team seats (#289), for every role: [{ id, label, isLead }] -- empty
  // while the careTeam feature is off. Being on a partner's care team is what
  // lets a non-staff login submit and edit that partner's prayer requests and
  // one-time needs (everything they enter is held for staff review before it
  // is dispatched) -- never decide a need, delete, or make anything public or
  // urgent. Staff (canWrite) can do all of that for any partner.
  const careTeamSeats = user?.careTeamSeats ?? [];
  const isOnCareTeamFor = (partnerId) => !!partnerId && careTeamSeats.some((s) => s.id === partnerId);
  const canSubmitFor = (partnerId) => canWrite || isOnCareTeamFor(partnerId);

  return {
    user,
    loading,
    canWrite,
    isAdmin,
    isGuest,
    guestTrips,
    guestTripIds,
    guestReadTripIds,
    canAccessTrip,
    careTeamSeats,
    isOnCareTeamFor,
    canSubmitFor,
  };
}
