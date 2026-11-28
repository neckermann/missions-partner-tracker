import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";
import { fetchSetupStatus } from "../api/client.js";

// Wraps the public-facing routes like RequireAdminAuth.jsx does for /admin, but checking feature
// toggles. `feature` is "publicDirectory", "publicMap", or "publicPrayerDigest"; partner detail
// passes both directory and map and renders if either is on. Those default to true (SettingsContext
// DEFAULTS) so children render during the initial fetch instead of flashing this notice.
//
// The public directory and map are off on a new install, so this notice is also the front page of a
// brand-new site: when no account exists yet it sends the person who just deployed it to /setup.
export default function RequirePublicSite({ feature, needs, children }) {
  const settings = useSettings();
  const { enabledFeatures, loading, churchName } = settings;
  const navigate = useNavigate();
  const features = Array.isArray(feature) ? feature : [feature];
  // `needs` names a further resolved setting that must be true (e.g. publicSubscribeAvailable: email can send).
  const allowed = features.some((f) => enabledFeatures[f]) && (!needs || settings[needs] !== false);

  useEffect(() => {
    if (allowed || loading) return;
    fetchSetupStatus()
      .then((status) => status.needed && navigate("/setup", { replace: true }))
      .catch(() => {});
  }, [allowed, loading, navigate]);

  if (!allowed) {
    return (
      <div style={{ maxWidth: "32rem", margin: "4rem auto", textAlign: "center", padding: "0 1rem" }}>
        {churchName && <p style={{ margin: 0, color: "var(--muted)" }}>{churchName}</p>}
        <h1>This isn't public</h1>
        <p style={{ color: "var(--muted)" }}>The church running this site hasn't made this page public.</p>
        <p>
          <Link to="/login">Go to admin login</Link>
        </p>
      </div>
    );
  }
  return children;
}
