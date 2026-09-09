import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";

// Wraps the three public-facing routes (directory, map, partner detail) --
// same "gate the route" role as RequireAdminAuth.jsx plays for /admin, just
// checking a feature toggle instead of a session. enabledFeatures.publicSite
// defaults to true (see SettingsContext's DEFAULTS) so this renders children
// during the initial settings fetch rather than flashing this notice first.
export default function RequirePublicSite({ children }) {
  const { enabledFeatures } = useSettings();
  if (!enabledFeatures.publicSite) {
    return (
      <div style={{ maxWidth: "32rem", margin: "4rem auto", textAlign: "center", padding: "0 1rem" }}>
        <h1>This directory isn't public</h1>
        <p style={{ color: "#555" }}>The church running this site has turned off the public directory and map.</p>
        <p>
          <Link to="/login">Go to admin login</Link>
        </p>
      </div>
    );
  }
  return children;
}
