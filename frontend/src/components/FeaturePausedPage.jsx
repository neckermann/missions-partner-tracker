import React from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../api/client.js";

// What a guest sees when what they were given depends on a feature the church has switched off (trips for a trip
// leader, care teams for a care team member): a plain "paused" page, not a sign-in screen and not an
// instruction to change a setting they cannot reach. Their access is kept and returns unchanged when the church
// turns the feature back on. `features` are the keys the server reports (guestAccess.js pausedFeatures).
const NAMES = { trips: "Trips", careTeam: "Care teams" };

export function pausedNames(features) {
  const names = (features || []).map((f) => NAMES[f]).filter(Boolean);
  return names.length > 0 ? names.join(" and ") : "this part of the app";
}

export default function FeaturePausedPage({ features, signOut = false }) {
  const navigate = useNavigate();
  const names = pausedNames(features);
  const lower = names.charAt(0).toLowerCase() + names.slice(1);
  return (
    <div className="admin-shell" style={{ maxWidth: 560, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <h2>{names} are paused</h2>
      <p>
        Your church has paused {lower} for now, so there is nothing for you to open here. Your account and
        your access have not been removed. When your church turns {lower} back on, everything will be there as
        you left it.
      </p>
      <p style={{ color: "var(--muted)" }}>
        If you have a question, ask the person at your church who set up your account.
      </p>
      {signOut && (
        <button
          type="button"
          className="btn secondary"
          onClick={async () => {
            try {
              await logout();
            } finally {
              navigate("/login");
            }
          }}
        >
          Sign out
        </button>
      )}
    </div>
  );
}
