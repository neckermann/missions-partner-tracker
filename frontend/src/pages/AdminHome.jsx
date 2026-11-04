import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCurrentUser } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

function buildSections(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures) {
  return [
    {
      to: "/admin/partners",
      title: usePartnerTermInAdmin ? partnerTermPlural : "Partners",
      description: "Missionaries, families, and partner organizations — profiles, trips, and contact info.",
    },
    enabledFeatures.monthlySupport && {
      to: "/admin/support/monthly",
      title: "Monthly Support",
      description: "Current monthly support across every partner, with a running total.",
    },
    enabledFeatures.oneTimeNeeds && {
      to: "/admin/support/needs",
      title: "One-Time Needs",
      description: "Track one-time gift requests and record decisions.",
    },
    enabledFeatures.prayerRequests && {
      to: "/admin/prayer-requests",
      title: "Prayer Requests",
      description: "Track prayer requests across every partner, short-term and long-term.",
    },
    enabledFeatures.trips && {
      to: "/admin/trips",
      title: "Trip History",
      description: "All mission trips across missionaries and organizations, with filters.",
    },
    enabledFeatures.trips && {
      to: "/admin/trips/opportunities",
      title: "Trip Opportunities",
      description: "Find partners who can host a trip you're planning, by team size and trip type.",
    },
    enabledFeatures.newsletters && {
      to: "/admin/newsletters",
      title: "Newsletters",
      description: "Upload and browse newsletters received from missionary and organization partners.",
    },
    enabledFeatures.documents && {
      to: "/admin/documents",
      title: "Documents",
      description:
        "Survey responses, signed policies, and other documents from missionary and organization partners.",
    },
    enabledFeatures.booklet && {
      to: "/admin/booklet",
      title: "Print Booklet",
      description: "Generate a printable prayer & support directory.",
    },
    enabledFeatures.reports && {
      to: "/admin/reports",
      title: "Reports",
      description: "Birthdays, one-time needs and more — download as CSV or print for a meeting.",
    },
  ].filter(Boolean);
}

// Mirrors AdminSidebar.jsx's buildSiteAdminLinks -- same pages, same
// order (including the notification-channel vs. data-integration split
// there -- GroupMe/Email send something out, Joshua Project/AI Request
// Scanning pull data in or process content, never notify anyone), just
// as tiles instead of a nav submenu, so an admin coming from Home can
// jump straight to one without going through the sidebar at all. No
// section-label tile here the way the sidebar has one -- this grid has
// no precedent for a non-card divider, and grouping by adjacency alone
// reads clearly enough at this size.
//
// GroupMe/Joshua Project/AI Extraction tiles always show regardless of
// their own feature flag -- deliberate, so an admin can configure them
// before turning them on (see each's settings route in routes/settings.js,
// none of which are requireFeature-gated). Email is gated like a real
// content feature instead (see #174/that route's own comment for why),
// so its tile only shows once the feature is actually on -- matching
// AdminSidebar.jsx's own enabledFeatures.email && check for the same link.
function buildSiteAdminSections(enabledFeatures) {
  return [
    {
      to: "/admin/settings/users",
      title: "Manage Users",
      description: "Who has access, their role, and their two-factor status.",
    },
    {
      to: "/admin/settings/branding",
      title: "Branding",
      description: "Public-site tagline, about text, brand color, logo, and partner terminology.",
    },
    {
      to: "/admin/settings/features",
      title: "Enabled Features",
      description: "Turn off anything this church isn't using.",
    },
    {
      to: "/admin/settings/about",
      title: "About Church",
      description: "Church name, contact info, and address.",
    },
    {
      to: "/admin/settings/groupme",
      title: "GroupMe",
      description: "Post new prayer requests to a GroupMe group automatically.",
    },
    enabledFeatures.email && {
      to: "/admin/settings/email",
      title: "Email",
      description: "Send email through a configured Postmark account.",
    },
    {
      to: "/admin/settings/joshua-project",
      title: "Joshua Project",
      description: "API key for country-level unreached-people-group statistics.",
    },
    {
      to: "/admin/settings/ai-extraction",
      title: "AI Request Scanning",
      description: "API key for scanning newsletters and documents for prayer requests and needs.",
    },
  ].filter(Boolean);
}

export default function AdminHome() {
  const [currentUser, setCurrentUser] = useState(null);
  const { partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const sections = buildSections(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures);
  const siteAdminSections = buildSiteAdminSections(enabledFeatures);

  useEffect(() => {
    fetchCurrentUser().then(setCurrentUser);
  }, []);

  return (
    <div className="admin-shell">
      <h2>Welcome{currentUser?.name ? `, ${currentUser.name}` : ""}</h2>
      <p style={{ color: "#555" }}>Pick a section to get started.</p>
      <div className="admin-card-grid">
        {sections.map((s) => (
          <Link key={s.to} to={s.to} className="admin-card">
            <h3>{s.title}</h3>
            <p>{s.description}</p>
          </Link>
        ))}
      </div>

      {currentUser?.role === "admin" && (
        <>
          <h2 style={{ marginTop: "2rem" }}>Site Administration</h2>
          <p style={{ color: "#555" }}>Church-wide settings — admin only.</p>
          <div className="admin-card-grid">
            {siteAdminSections.map((s) => (
              <Link key={s.to} to={s.to} className="admin-card">
                <h3>{s.title}</h3>
                <p>{s.description}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
