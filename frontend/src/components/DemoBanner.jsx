import React from "react";
import { useSettings } from "../context/SettingsContext.jsx";

// Shown only on a public demo deployment (DEMO_RESET_TOKEN set -- see the
// comment on isDemo in routes/publicSettings.js), entirely separate from
// a real church's own About Church content, which this never touches.
//
// Lists every published login a visitor can try: the admin, plus the
// limited-access ones (a care team member, a trip leader -- see
// utils/demoLogins.js), so they can see what each kind of person gets.
export default function DemoBanner() {
  const { isDemo, demoLoginEmail, demoLoginPassword, demoGuestLogins } = useSettings();
  if (!isDemo) return null;

  const hasAdmin = demoLoginEmail && demoLoginPassword;
  const guests = demoGuestLogins || [];
  // When every login has the same password (the default: the guests follow the
  // admin's), say it once instead of repeating it on each line.
  const passwords = [hasAdmin ? demoLoginPassword : null, ...guests.map((g) => g.password)].filter(Boolean);
  const sharedPassword = passwords.length > 1 && new Set(passwords).size === 1 ? passwords[0] : null;

  return (
    <div className="demo-banner">
      <p className="demo-banner-title">You're viewing a live public demo</p>
      <p>
        Everything here is fake seeded data, and it resets automatically on a schedule — nothing you do is
        permanent.
      </p>
      {(hasAdmin || guests.length > 0) && (
        <div>
          <p>
            Try it from the inside at{" "}
            <a href="/login" target="_blank" rel="noreferrer">
              /login
            </a>
            , signed in as:
          </p>
          {sharedPassword && (
            <p>
              The password is the same for all of them: <code>{sharedPassword}</code>
            </p>
          )}
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            {hasAdmin && (
              <li>
                <strong>Admin</strong> — <code>{demoLoginEmail}</code>
                {!sharedPassword && (
                  <>
                    {" "}
                    / <code>{demoLoginPassword}</code>
                  </>
                )}
                . Sees and does everything.
              </li>
            )}
            {guests.map((g) => (
              <li key={g.key}>
                <strong>{g.label}</strong> — <code>{g.email}</code>
                {!sharedPassword && (
                  <>
                    {" "}
                    / <code>{g.password}</code>
                  </>
                )}
                . {g.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        <a href="https://missionspartnertracker.com" target="_blank" rel="noreferrer">
          See screenshots, features, and setup docs →
        </a>
      </p>
    </div>
  );
}
