import React from "react";
import { Navigate } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";
import RequirePublicSite from "./RequirePublicSite.jsx";

// The site's front page ("/"). The directory is the front page when it is on. A church that shows only the map (or
// only its trip listings) has no directory, so "/" sends visitors to the map (or the trips) instead of telling them
// the site is private. With none on, the usual "this isn't public" notice (which also sends a brand-new install to
// /setup) is what they see.
export default function PublicHome({ directory }) {
  const { enabledFeatures } = useSettings();
  if (!enabledFeatures.publicDirectory) {
    if (enabledFeatures.publicMap) return <Navigate to="/map" replace />;
    if (enabledFeatures.publicTripDiscovery) return <Navigate to="/trips" replace />;
  }
  return <RequirePublicSite feature="publicDirectory">{directory}</RequirePublicSite>;
}
