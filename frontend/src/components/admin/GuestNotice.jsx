import React from "react";
import useCurrentUser from "../../hooks/useCurrentUser.js";

// One plain line, always at the top of the admin shell for a guest login: what they are, what is hidden,
// and (for a care team member) that what they add waits for staff approval. A guest has no other place that
// says this, and nothing else on the screen explains why most of the app is missing.
export function guestNoticeText({ careTeamSeats = [], guestTripIds = [] }) {
  const onCareTeam = careTeamSeats.length > 0;
  const onTrips = guestTripIds.length > 0;
  const sees = [
    onTrips && "the trips you were given",
    onCareTeam && "the partners whose care team you are on",
  ]
    .filter(Boolean)
    .join(" and ");
  const base = `You're signed in as a guest, so you can see only ${sees || "what you were given"}. The rest of the app is hidden from you.`;
  return onCareTeam
    ? `${base} Prayer requests, needs and files you add wait for staff approval before anyone is notified.`
    : base;
}

export default function GuestNotice() {
  const { isGuest, careTeamSeats, guestTripIds, loading } = useCurrentUser();
  if (loading || !isGuest) return null;
  return (
    <p
      className="guest-notice"
      role="note"
      style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 1rem" }}
    >
      {guestNoticeText({ careTeamSeats, guestTripIds })}
    </p>
  );
}

// The line at the point a care team member adds something: it will not go out until staff approve it.
export function HeldForReviewNote() {
  const { isGuest, careTeamSeats } = useCurrentUser();
  if (!isGuest || !(careTeamSeats?.length > 0)) return null;
  return (
    <p className="held-note" style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
      What you add here waits for staff approval before anyone is notified.
    </p>
  );
}
