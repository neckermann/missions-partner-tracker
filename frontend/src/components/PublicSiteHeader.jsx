import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";
import ThemeToggle from "./shared/ThemeToggle.jsx";

// Shared across all 4 public-site pages (PublicDirectory, PublicMap,
// PublicPartnerDetail, PublicSubscribe) -- previously each had its own
// independent header with its own nav-link labels/styling, which had
// already drifted (e.g. "View Map" vs "Partner Directory" for the same
// destination). One component, one source of truth for the nav-link row;
// each page still owns its own title/subtitle and anything extra
// (PublicMap's Start/Stop Tour button) via children.
const NAV_LINKS = [
  { to: "/", label: "Directory", feature: "publicDirectory" },
  { to: "/map", label: "Map", feature: "publicMap" },
  {
    to: "/subscribe",
    label: (partnerTermPlural) => `Pray for our ${partnerTermPlural}`,
    feature: "publicPrayerDigest",
  },
  { to: "/trips", label: "Trip Opportunities", feature: "publicTripDiscovery" },
];

export default function PublicSiteHeader({ title, subtitle, children }) {
  const { logo, partnerTermPlural, enabledFeatures } = useSettings();
  const { pathname } = useLocation();

  return (
    <header className="app-header">
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {logo?.url && <img src={logo.url} alt="" className="header-logo" />}
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="header-tagline">{subtitle}</p>}
        </div>
      </div>
      <div className="app-header-nav">
        {NAV_LINKS.filter((l) => l.to !== pathname && enabledFeatures[l.feature]).map((l) => (
          <Link key={l.to} to={l.to} style={{ color: "white" }}>
            {typeof l.label === "function" ? l.label(partnerTermPlural) : l.label}
          </Link>
        ))}
        {children}
        {/* Visitors follow their device's setting unless they pick Light or Dark here. */}
        <ThemeToggle compact />
      </div>
    </header>
  );
}
