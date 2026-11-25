import React from "react";
import { useSettings } from "../context/SettingsContext.jsx";
import CardGrid from "../components/admin/CardGrid.jsx";

function buildSections(enabledFeatures) {
  return [
    {
      to: "/admin/settings/about",
      title: "About & Branding",
      icon: "🎨",
      description:
        "Church info, contact details, public-site tagline, colors, font, logo, and partner terminology.",
    },
    {
      to: "/admin/settings/users",
      title: "Manage Users",
      icon: "👥",
      description: "Admin accounts and their roles.",
    },
    enabledFeatures.auditTrail && {
      to: "/admin/settings/audit",
      title: "Audit log",
      icon: "📜",
      description: "Who did what and when: sign-ins, access and settings changes, deletes, backups.",
    },
    {
      to: "/admin/settings/features",
      title: "Enabled Features",
      icon: "🧩",
      description: "Turn features on or off for this church.",
    },
    enabledFeatures.trips && {
      to: "/admin/settings/trips",
      title: "Trips",
      icon: "✈️",
      description: "Question library, requirement templates, and budgeting.",
    },
    enabledFeatures.careTeam && {
      to: "/admin/settings/care-team",
      title: "Care Teams",
      icon: "🤝",
      description: "The default lead for partners without a care team, and key-date reminders.",
    },
    enabledFeatures.supportPreferences &&
      enabledFeatures.careTeam && {
        to: "/admin/settings/support-preferences",
        title: "Support Preferences",
        icon: "💛",
        description: "The menu of ways your church and a partner's care team can support them.",
      },
    (enabledFeatures.outboundEmail || enabledFeatures.inboundEmail) && {
      to: "/admin/settings/email",
      title: "Email",
      icon: "✉️",
      description: "Sending and receiving email through Postmark.",
    },
    enabledFeatures.groupme && {
      to: "/admin/settings/groupme",
      title: "GroupMe",
      icon: "💬",
      description: "Connect a GroupMe group for dispatches.",
    },
    enabledFeatures.whatsapp && {
      to: "/admin/settings/whatsapp",
      title: "WhatsApp",
      icon: "📱",
      description: "Connect a WhatsApp community for dispatches.",
    },
    (enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail) && {
      to: "/admin/settings/dispatches",
      title: "Dispatches",
      icon: "🗓️",
      description: "Subscriber counts, the restricted-partner safety gate, and send schedules.",
    },
    (enabledFeatures.aiExtraction || enabledFeatures.joshuaProject) && {
      to: "/admin/settings/integrations",
      title: "Integrations",
      icon: "🔌",
      description: "API keys for AI request scanning and Joshua Project stats.",
    },
    {
      to: "/admin/settings/system-info",
      title: "About App",
      icon: "ℹ️",
      description: "What's running on this instance, plus database backups.",
    },
  ].filter(Boolean);
}

export default function AdminSettingsHome() {
  const { enabledFeatures } = useSettings();
  const sections = buildSections(enabledFeatures);

  return (
    <div className="admin-shell">
      <h2>Settings</h2>
      <p style={{ color: "var(--muted)" }}>Configuration for this church's instance of the app.</p>
      <CardGrid sections={sections} />
    </div>
  );
}
