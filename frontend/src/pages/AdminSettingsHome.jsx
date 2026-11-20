import React from "react";
import { useSettings } from "../context/SettingsContext.jsx";
import CardGrid from "../components/admin/CardGrid.jsx";

function buildSections(enabledFeatures) {
  return [
    {
      to: "/admin/settings/about",
      title: "About & Branding",
      description: "Church info, contact details, public-site tagline, colors, font, logo, and partner terminology.",
    },
    {
      to: "/admin/settings/users",
      title: "Manage Users",
      description: "Admin accounts and their roles.",
    },
    {
      to: "/admin/settings/features",
      title: "Enabled Features",
      description: "Turn features on or off for this church.",
    },
    {
      to: "/admin/settings/system-info",
      title: "About App",
      description: "What's running on this instance, plus database backups.",
    },
    enabledFeatures.trips && {
      to: "/admin/settings/trips",
      title: "Trips",
      description: "Question library, requirement templates, and budgeting.",
    },
    (enabledFeatures.outboundEmail || enabledFeatures.inboundEmail) && {
      to: "/admin/settings/email",
      title: "Email",
      description: "Sending and receiving email through Postmark.",
    },
    enabledFeatures.groupme && {
      to: "/admin/settings/groupme",
      title: "GroupMe",
      description: "Connect a GroupMe group for dispatches.",
    },
    enabledFeatures.whatsapp && {
      to: "/admin/settings/whatsapp",
      title: "WhatsApp",
      description: "Connect a WhatsApp community for dispatches.",
    },
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      to: "/admin/settings/dispatches",
      title: "Dispatches",
      description: "Subscriber counts, the restricted-partner safety gate, and send schedules.",
    },
    (enabledFeatures.aiExtraction || enabledFeatures.joshuaProject) && {
      to: "/admin/settings/integrations",
      title: "Integrations",
      description: "API keys for AI request scanning and Joshua Project stats.",
    },
  ].filter(Boolean);
}

export default function AdminSettingsHome() {
  const { enabledFeatures } = useSettings();
  const sections = buildSections(enabledFeatures);

  return (
    <div className="admin-shell">
      <h2>Settings</h2>
      <p style={{ color: "#555" }}>Configuration for this church's instance of the app.</p>
      <CardGrid sections={sections} />
    </div>
  );
}
