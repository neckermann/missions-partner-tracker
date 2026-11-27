import React from "react";
import { Link } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import FeaturePausedPage from "./FeaturePausedPage.jsx";

// Admin-side counterpart to RequirePublicSite.jsx: gates a page behind feature toggles. The API
// routes 404 independently (middleware/requireFeature.js); this just shows a clear explanation
// instead of a broken page. `feature` is a key or an array meaning "reachable if any is on" (as in
// requireFeature(keyOrKeys)), e.g. Dispatch Settings with GroupMe or Email.
export default function RequireAdminFeature({ feature, children }) {
  const { enabledFeatures } = useSettings();
  const { isGuest, loading } = useCurrentUser();
  const enabled = Array.isArray(feature)
    ? feature.some((key) => enabledFeatures[key])
    : enabledFeatures[feature];
  if (!enabled) {
    // A guest cannot reach Church Settings, so they are told it is paused, not where to switch it back on.
    const paused = (Array.isArray(feature) ? feature : [feature]).filter(
      (f) => f === "trips" || f === "careTeam"
    );
    if (!loading && isGuest && paused.length > 0) return <FeaturePausedPage features={paused} />;
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
