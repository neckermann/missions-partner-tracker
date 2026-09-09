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
      description: "Survey responses, signed policies, and other documents from missionary and organization partners.",
    },
    enabledFeatures.booklet && {
      to: "/admin/booklet",
      title: "Print Booklet",
      description: "Generate a printable prayer & support directory.",
    },
  ].filter(Boolean);
}

const ADMIN_ONLY_SECTIONS = [
  {
    to: "/admin/settings",
    title: "Site Administration",
    description: "Manage users, branding, feature toggles, single sign-on, and church info.",
  },
];

export default function AdminHome() {
  const [currentUser, setCurrentUser] = useState(null);
  const { partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const sections = buildSections(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures);

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
        {currentUser?.role === "admin" &&
          ADMIN_ONLY_SECTIONS.map((s) => (
            <Link key={s.to} to={s.to} className="admin-card">
              <h3>{s.title}</h3>
              <p>{s.description}</p>
            </Link>
          ))}
      </div>
    </div>
  );
}
