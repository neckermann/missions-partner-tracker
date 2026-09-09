import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";

// Admin-side counterpart to RequirePublicSite.jsx -- gates a page behind
// one of this church's feature toggles instead of a session. The
// underlying API routes 404 independently (see requireFeature.js on the
// backend) for defense in depth; this just keeps a direct visit from
// hitting a broken-looking page instead of a clear explanation.
export default function RequireAdminFeature({ feature, children }) {
  const { enabledFeatures } = useSettings();
  if (!enabledFeatures[feature]) {
    return (
      <div className="admin-shell">
        <h2>This feature is turned off</h2>
        <p style={{ color: "#555" }}>
          Turn it back on at <Link to="/admin/settings/features">Church Settings &rsaquo; Features</Link> to
          use this page again.
        </p>
      </div>
    );
  }
  return children;
}
