import React from "react";
import { useSettings } from "../context/SettingsContext.jsx";

// Shown only on a public demo deployment (DEMO_RESET_TOKEN set -- see the
// comment on isDemo in routes/publicSettings.js), entirely separate from
// a real church's own About Church content, which this never touches.
export default function DemoBanner() {
  const { isDemo, demoLoginEmail, demoLoginPassword } = useSettings();
  if (!isDemo) return null;

  return (
    <div className="demo-banner">
      <p className="demo-banner-title">You're viewing a live public demo</p>
      <p>
        Everything here is fake seeded data, and it resets automatically on a schedule — nothing you do is
        permanent.
      </p>
      {demoLoginEmail && demoLoginPassword && (
        <p>
          Try the admin dashboard at <a href="/login">/login</a> with <code>{demoLoginEmail}</code> /{" "}
          <code>{demoLoginPassword}</code>.
        </p>
      )}
      <p>
        <a href="https://missionspartnertracker.com" target="_blank" rel="noreferrer">
          See screenshots, features, and setup docs →
        </a>
      </p>
    </div>
  );
}
