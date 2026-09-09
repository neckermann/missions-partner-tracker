import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";

// Wraps the three public-facing routes (directory, map, partner detail) --
// same "gate the route" role as RequireAdminAuth.jsx plays for /admin, just
// checking feature toggle(s) instead of a session. `feature` is either
// "publicDirectory" or "publicMap" for those two pages themselves; the
// partner-detail page (linked from both) passes both keys and renders as
// long as at least one is on. Both default to true (see SettingsContext's
// DEFAULTS) so this renders children during the initial settings fetch
// rather than flashing this notice first.
export default function RequirePublicSite({ feature, children }) {
  const { enabledFeatures } = useSettings();
  const features = Array.isArray(feature) ? feature : [feature];
  const allowed = features.some((f) => enabledFeatures[f]);

  if (!allowed) {
    return (
      <div style={{ maxWidth: "32rem", margin: "4rem auto", textAlign: "center", padding: "0 1rem" }}>
        <h1>This isn't public</h1>
        <p style={{ color: "#555" }}>The church running this site has turned this off.</p>
        <p>
          <Link to="/login">Go to admin login</Link>
        </p>
      </div>
    );
  }
  return children;
}
