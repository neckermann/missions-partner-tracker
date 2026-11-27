import { useEffect, useState } from "react";
import { fetchCurrentUser } from "../api/client.js";

// The one place pages get role-derived permission flags. Exposes `canWrite` (admin or editor) and
// `isAdmin` only, not a single `canDelete`: delete permission varies by resource (some allow
// editor-delete), so each call site combines them per its backend rule.
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
  // Guest tier: a scoped login with editor-equivalent write access to each trip it was granted
  // (never reflected in the global canWrite) and read-only on those trips' partners. Trip pages
  // combine canAccessTrip with their own check. guestTrips comes from /me:
  // [{ id, label, partnerId, partnerLabel, expiresAt }] for each active grant.
  const isGuest = user?.role === "guest";
  const guestTrips = isGuest ? (user?.guestTrips ?? []) : [];
  const guestTripIds = guestTrips.map((t) => t.id);
  // Every trip a guest may open: granted trips (editable) plus care-team partners' trips (view only).
  const guestReadTripIds = isGuest ? (user?.guestReadTripIds ?? guestTripIds) : [];
  const canAccessTrip = (tripId) => isGuest && !!tripId && guestTripIds.includes(tripId);

  // Care team seats, for every role: [{ id, label, isLead }], empty while the careTeam feature is
  // off. A seat lets a non-staff login submit and edit that partner's prayer requests and one-time
  // needs (held for staff review before dispatch), never decide, delete, or make anything public or
  // urgent. Staff can do all of that for any partner.
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
    // Admins only: the address the site is set to (APP_BASE_URL), or null. See SiteAddressBanner.
    configuredSiteOrigin: user?.configuredSiteOrigin ?? null,
    // On the church's missions team: looks after every partner with no care team of its own.
    onMissionsTeam: user?.onMissionsTeam === true,
    isOnCareTeamFor,
    canSubmitFor,
  };
}
