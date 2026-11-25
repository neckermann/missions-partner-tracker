import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";

// Wraps the public-facing routes like RequireAdminAuth.jsx does for /admin, but checking feature
// toggles. `feature` is "publicDirectory", "publicMap", or "publicPrayerDigest"; partner detail
// passes both directory and map and renders if either is on. Those default to true (SettingsContext
// DEFAULTS) so children render during the initial fetch instead of flashing this notice.
export default function RequirePublicSite({ feature, children }) {
  const { enabledFeatures } = useSettings();
  const features = Array.isArray(feature) ? feature : [feature];
  const allowed = features.some((f) => enabledFeatures[f]);

  if (!allowed) {
    return (
      <div style={{ maxWidth: "32rem", margin: "4rem auto", textAlign: "center", padding: "0 1rem" }}>
        <h1>This isn't public</h1>
        <p style={{ color: "var(--muted)" }}>The church running this site has turned this off.</p>
        <p>
          <Link to="/login">Go to admin login</Link>
        </p>
      </div>
    );
  }
  return children;
}
