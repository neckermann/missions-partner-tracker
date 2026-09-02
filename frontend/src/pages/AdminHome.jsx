import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCurrentUser } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

function buildSections(partnerTermPlural, usePartnerTermInAdmin) {
  return [
    {
      to: "/admin/partners",
      title: usePartnerTermInAdmin ? partnerTermPlural : "Partners",
      description: "Missionaries, families, and partner organizations — profiles, trips, and contact info.",
    },
  {
    to: "/admin/support/monthly",
    title: "Monthly Support",
    description: "Current monthly support across every partner, with a running total.",
  },
  {
    to: "/admin/support/needs",
    title: "One-Time Needs",
    description: "Track one-time gift requests and record decisions.",
  },
  {
    to: "/admin/trips",
    title: "Trip History",
    description: "All mission trips across missionaries and organizations, with filters.",
  },
  {
    to: "/admin/trips/opportunities",
    title: "Trip Opportunities",
    description: "Find partners who can host a trip you're planning, by team size and trip type.",
  },
  {
    to: "/admin/newsletters",
    title: "Newsletters",
    description: "Upload and browse newsletters received from missionary and organization partners.",
  },
    {
      to: "/admin/booklet",
      title: "Print Booklet",
      description: "Generate a printable prayer & support directory.",
    },
  ];
}

const ADMIN_ONLY_SECTIONS = [
  {
    to: "/admin/users",
    title: "Manage Users",
    description: "Add, edit, or remove admin accounts, and manage two-factor authentication.",
  },
  {
    to: "/admin/settings",
    title: "Church Settings",
    description: "Church info, partner terminology, and public site branding.",
  },
];

export default function AdminHome() {
  const [currentUser, setCurrentUser] = useState(null);
  const { partnerTermPlural, usePartnerTermInAdmin } = useSettings();
  const sections = buildSections(partnerTermPlural, usePartnerTermInAdmin);

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
