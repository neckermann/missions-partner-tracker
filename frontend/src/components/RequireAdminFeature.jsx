import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";

// Admin-side counterpart to RequirePublicSite.jsx -- gates a page behind
// one of this church's feature toggles instead of a session. The
// underlying API routes 404 independently (see requireFeature.js on the
// backend) for defense in depth; this just keeps a direct visit from
// hitting a broken-looking page instead of a clear explanation.
//
// `feature` is a single key, or an array for "reachable as long as at
// least one is on" -- same any-of semantics as the backend's own
// requireFeature(keyOrKeys) (see middleware/requireFeature.js), used
// here for pages like Notifications that make sense if either GroupMe
// or Email is on, not strictly both.
export default function RequireAdminFeature({ feature, children }) {
  const { enabledFeatures } = useSettings();
  const enabled = Array.isArray(feature)
    ? feature.some((key) => enabledFeatures[key])
    : enabledFeatures[feature];
  if (!enabled) {
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
