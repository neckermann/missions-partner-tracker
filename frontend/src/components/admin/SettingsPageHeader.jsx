import React from "react";
import { Link } from "react-router-dom";

// The one piece of chrome every Settings sub-page was missing (Phase 4 of
// the UX-rebuild plan): a consistent way back, matching the "← Back to X"
// convention TripDetailLayout.jsx already established, since there is no
// dedicated Settings landing page to return to -- the sidebar's own Settings
// group (AdminSidebar.jsx) already lists every sub-page whenever it's
// expanded, so this is a fallback for whenever that group isn't open (e.g.
// a direct link, or a narrow viewport where the sidebar is collapsed), not a
// second nav system. `/admin/settings` itself redirects to `about`.
export default function SettingsPageHeader({ title, actions = null }) {
  return (
    <>
      <Link to="/admin/settings" className="settings-back-link">
        ← Back to Settings
      </Link>
      {actions ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ marginBottom: 0 }}>{title}</h2>
          {actions}
        </div>
      ) : (
        <h2>{title}</h2>
      )}
    </>
  );
}
