import React from "react";
import { useSettings } from "../context/SettingsContext.jsx";
import CardGrid from "../components/admin/CardGrid.jsx";

// Landing page for the sidebar's "Partner Care" group (AdminSidebar.jsx)
// -- a group earns one of these once it has 3+ children (the mockup's
// own rule), same reasoning Settings' card grid on AdminHome.jsx
// already followed. Same five children as the sidebar
// group, same gating -- see that file's buildGroups for why each one is
// gated the way it is.
function buildSections(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures) {
  return [
    {
      to: "/admin/partners",
      title: usePartnerTermInAdmin ? partnerTermPlural : "Partners",
      description: "Missionaries, families, and partner organizations — profiles, trips, and contact info.",
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
    enabledFeatures.partnerFiles && {
      to: "/admin/partner-files",
      title: "Newsletters & Docs",
      description:
        "Upload and browse newsletters, survey responses, signed policies, and other documents from missionary and organization partners.",
    },
  ].filter(Boolean);
}

export default function AdminPartnerCare() {
  const { partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const sections = buildSections(partnerTermPlural, usePartnerTermInAdmin, enabledFeatures);

  return (
    <div className="admin-shell">
      <h2>Partner Care</h2>
      <p style={{ color: "#555" }}>Everything tracked about and for an individual partner.</p>
      <CardGrid sections={sections} />
    </div>
  );
}
