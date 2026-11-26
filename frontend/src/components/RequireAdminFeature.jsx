import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";

// Admin-side counterpart to RequirePublicSite.jsx: gates a page behind feature toggles. The API
// routes 404 independently (middleware/requireFeature.js); this just shows a clear explanation
// instead of a broken page. `feature` is a key or an array meaning "reachable if any is on" (as in
// requireFeature(keyOrKeys)), e.g. Dispatch Settings with GroupMe or Email.
export default function RequireAdminFeature({ feature, children }) {
  const { enabledFeatures } = useSettings();
  const enabled = Array.isArray(feature)
    ? feature.some((key) => enabledFeatures[key])
    : enabledFeatures[feature];
  if (!enabled) {
    return (
      <div className="admin-shell">
        <h2>This feature is turned off</h2>
        <p style={{ color: "var(--muted)" }}>
          Turn it back on at <Link to="/admin/settings/features">Church Settings &rsaquo; Features</Link> to
          use this page again.
        </p>
      </div>
    );
  }
  return children;
}
