import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCurrentUser } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

function CardGrid({ sections }) {
  return (
    <div className="admin-card-grid">
      {sections.map((s) => (
        <Link key={s.to} to={s.to} className="admin-card">
          <h3>{s.title}</h3>
          <p>{s.description}</p>
        </Link>
      ))}
    </div>
  );
}

function buildSections(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures) {
  return [
    {
      to: "/admin/partners",
      title: usePartnerTermInAdmin ? partnerTermPlural : "Partners",
      description: "Missionaries, families, and partner organizations — profiles, trips, and contact info.",
    },
    enabledFeatures.inboundEmail && {
      to: "/admin/inbound-email",
      title: "Unmatched Emails",
      description: "Inbound emails that couldn't be automatically matched to a partner -- assign or discard.",
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
    enabledFeatures.prayerRequests && {
      to: "/admin/prayer-requests",
      title: "Prayer Requests",
      description: "Track prayer requests across every partner, short-term and long-term.",
    },
    enabledFeatures.oneTimeNeeds && {
      to: "/admin/support/needs",
      title: "One-Time Needs",
      description: "Track one-time gift requests and record decisions.",
    },
    enabledFeatures.monthlySupport && {
      to: "/admin/support/monthly",
      title: "Monthly Support",
      description: "Current monthly support across every partner, with a running total.",
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
// three-way grouping (core / Communications / Integrations) and same
// section-label treatment, just as a labeled card grid instead of a nav
// submenu, so an admin coming from Home can jump straight to one without
// going through the sidebar at all. Returns the three groups separately
// (rather than one flat array) so the render below can put a heading
// above each, matching the sidebar's own dividers and
// AdminSettingsFeatures.jsx's own three-block split.
//
// Every optional-integration tile here is gated by its own feature flag
// -- same standing rule as every nav link in AdminSidebar.jsx (off means
// genuinely hidden, not just a discovery affordance). This used to let
// GroupMe/Joshua Project/AI Extraction's tiles always show regardless of
// their flag, on the theory that an admin should be able to configure
// them before turning them on (their settings routes aren't
// requireFeature-gated on the backend either) -- but that meant Home and
// the sidebar disagreed with each other for the exact same links, which
// is more confusing than useful. An admin still reaches any of these
// pages the first time via Enabled Features (never gated) turning the
// flag on, exactly like every other feature in this app.
function buildSiteAdminSections(enabledFeatures) {
  const core = [
    {
      to: "/admin/settings/about",
      title: "About Church",
      description: "Church name, contact info, and address.",
    },
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
      to: "/admin/settings/backups",
      title: "Backups",
      description: "Download a full database backup on demand, or manage the periodic reminder.",
    },
  ];
  const communications = [
    (enabledFeatures.outboundEmail || enabledFeatures.inboundEmail) && {
      to: "/admin/settings/email",
      title: "Email",
      description:
        "Send and/or receive email through a configured Postmark account -- each direction can be turned on independently.",
    },
    enabledFeatures.groupme && {
      to: "/admin/settings/groupme",
      title: "GroupMe",
      description: "Post new prayer requests to a GroupMe group automatically.",
    },
    (enabledFeatures.groupme || enabledFeatures.outboundEmail) && {
      to: "/admin/notifications",
      title: "Notifications",
      description: "Review and send what's queued -- on a schedule, or on demand.",
    },
  ].filter(Boolean);
  const integrations = [
    enabledFeatures.aiExtraction && {
      to: "/admin/settings/ai-extraction",
      title: "AI Features",
      description: "API key for scanning newsletters and documents for prayer requests and needs.",
    },
    enabledFeatures.joshuaProject && {
      to: "/admin/settings/joshua-project",
      title: "Joshua Project",
      description: "API key for country-level unreached-people-group statistics.",
    },
  ].filter(Boolean);
  return { core, communications, integrations };
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
      <CardGrid sections={sections} />

      {currentUser?.role === "admin" && (
        <>
          <h2 style={{ marginTop: "2rem" }}>Site Administration</h2>
          <p style={{ color: "#555" }}>Church-wide settings — admin only.</p>
          <CardGrid sections={siteAdminSections.core} />

          {siteAdminSections.communications.length > 0 && (
            <>
              <h3 style={{ marginTop: "1.5rem" }}>Communications</h3>
              <CardGrid sections={siteAdminSections.communications} />
            </>
          )}

          {siteAdminSections.integrations.length > 0 && (
            <>
              <h3 style={{ marginTop: "1.5rem" }}>Integrations</h3>
              <CardGrid sections={siteAdminSections.integrations} />
            </>
          )}
        </>
      )}
    </div>
  );
}
