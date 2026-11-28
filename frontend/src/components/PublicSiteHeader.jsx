import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useSettings } from "../context/SettingsContext.jsx";
import ThemeToggle from "./shared/ThemeToggle.jsx";

// Shared by the four public-site pages so the nav-link row has one source of truth; each page owns
// its title/subtitle and extras (e.g. PublicMap's tour button) via children.
const NAV_LINKS = [
  { to: "/", label: "Directory", feature: "publicDirectory" },
  { to: "/map", label: "Map", feature: "publicMap" },
  {
    to: "/subscribe",
    label: (partnerTermPlural) => `Pray for our ${partnerTermPlural}`,
    feature: "publicPrayerDigest",
    // Hidden too while signing up cannot work (no working email), so the link never leads to "Not found".
    needs: "publicSubscribeAvailable",
  },
  { to: "/trips", label: "Trip Opportunities", feature: "publicTripDiscovery" },
];

// `plain` is for pages someone reaches only through a private link (a survey, their own trip page,
// an application link): the church's name and logo, but none of the public menu and no team sign-in.
export default function PublicSiteHeader({ title, subtitle, plain = false, children }) {
  const settings = useSettings();
  const { logo, partnerTermPlural, enabledFeatures, churchName } = settings;
  const { pathname } = useLocation();

  return (
    <header className="app-header">
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {logo?.url && <img src={logo.url} alt="" className="header-logo" />}
        <div>
          {/* Whose site this is, on every public page (the page title says what the page is). */}
          {churchName && <p className="header-church">{churchName}</p>}
          <h1>{title}</h1>
          {subtitle && <p className="header-tagline">{subtitle}</p>}
        </div>
      </div>
      <div className="app-header-nav">
        {!plain &&
          NAV_LINKS.filter(
            (l) =>
              l.to !== pathname && enabledFeatures[l.feature] && (!l.needs || settings[l.needs] !== false)
          ).map((l) => (
            <Link key={l.to} to={l.to} style={{ color: "white" }}>
              {typeof l.label === "function" ? l.label(partnerTermPlural) : l.label}
            </Link>
          ))}
        {children}
        {/* The way in for the team, on every public page. */}
        {!plain && pathname !== "/login" && (
          <Link to="/login" style={{ color: "white", opacity: 0.85 }}>
            Team sign in
          </Link>
        )}
        {/* Visitors follow their device's setting unless they pick Light or Dark here. */}
        <ThemeToggle compact />
      </div>
    </header>
  );
}
