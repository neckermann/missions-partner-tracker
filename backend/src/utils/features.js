// Canonical registry of gate-able optional features: the single source of truth
// for valid `enabledFeatures` keys (see ChurchSettings in schema.prisma). The
// label and description travel to the frontend with the settings payload, so
// adding a feature is adding an entry here.
//
// `group` is "public" for a toggle a logged-out visitor can notice ("/", "/map",
// or Trip Opportunities) and "admin" otherwise; it drives the split in
// pages/AdminSettingsFeatures.jsx. Admin order mirrors the nav: core content,
// then Communications, then Integrations; `section` ("communications" |
// "integrations" | omitted for core) splits the list into those blocks.
const FEATURES = {
  publicDirectory: {
    label: "Public directory",
    description:
      'The public list/search view at the site\'s root ("/"). Turning this off shows a private-instance message there instead.',
    defaultEnabled: true,
    group: "public",
  },
  publicMap: {
    label: "Public map",
    description:
      'The public map view ("/map"). Turning this off shows a private-instance message there instead.',
    defaultEnabled: true,
    group: "public",
  },
  partnerFiles: {
    label: "Newsletters & Docs",
    description:
      "Newsletters and documents (survey responses, signed policies, etc.) on missionary/organization pages and their own admin section.",
    defaultEnabled: true,
    group: "admin",
  },
  prayerRequests: {
    label: "Prayer requests",
    description:
      "The Prayer Requests admin section, and the prayer request list on missionary/organization pages.",
    defaultEnabled: true,
    group: "admin",
  },
  oneTimeNeeds: {
    label: "One-time needs",
    description:
      "The One-Time Needs admin section, and the one-time needs list on missionary/organization pages.",
    defaultEnabled: true,
    group: "admin",
  },
  monthlySupport: {
    label: "Monthly support",
    description: "The Monthly Support report page.",
    defaultEnabled: true,
    group: "admin",
  },
  // The whole recruiting/team/support-raising area. Off by default because it
  // also gates a public application form, a public support-raising page and
  // outbound email.
  trips: {
    label: "Mission trips",
    description:
      "Trip tracking, recruiting, teams, meetings, documents, and support raising. The Trips and Plan a Trip admin pages.",
    defaultEnabled: false,
    group: "admin",
  },
  // Public discoverability only: the discovery listing and the id-addressed
  // application route for an isPublic trip. Separate from trips (like
  // publicDirectory) so a church can run trips by private link with no public footprint.
  publicTripDiscovery: {
    label: "Public trip discovery",
    description:
      "The public Trip Opportunities page and plain trip-application links. Also requires Mission trips to be on. A trip's own private application/support-raising links work regardless of this flag.",
    defaultEnabled: false,
    group: "public",
  },
  booklet: {
    label: "Print booklet",
    description: "The printable prayer & support directory generator.",
    defaultEnabled: true,
    group: "admin",
  },
  reports: {
    label: "Reports",
    description:
      "Read-only reports over existing data — committed support, prayer requests, one-time needs, data completeness, trip fundraising and readiness, mailing list — with CSV download and a print view.",
    defaultEnabled: true,
    group: "admin",
  },
  // Outbound sending and its inbound half are independent flags: a church may want
  // one direction. They share the Settings -> Email page (one Postmark account) but
  // each gates its own routes. Off by default.
  outboundEmail: {
    label: "Email (Sending)",
    description:
      "Send email through a configured Postmark account. On its own, this already lets any admin/editor/viewer set up their own digest (prayer requests, one-time needs, and newsletters) from their Account Settings -- no separate toggle for that.",
    defaultEnabled: false,
    group: "admin",
    section: "communications",
  },
  inboundEmail: {
    label: "Email (Receiving)",
    description: "Receive email through a configured Postmark account, matched to partners automatically.",
    defaultEnabled: false,
    group: "admin",
    section: "communications",
  },
  groupme: {
    label: "GroupMe dispatch",
    description:
      "Post new prayer requests, one-time needs, and newsletters to their own configured GroupMe Topics as they're added.",
    defaultEnabled: false,
    group: "admin",
    section: "communications",
  },
  whatsapp: {
    label: "WhatsApp dispatch",
    description:
      "Post new prayer requests, one-time needs, and newsletters to their own configured WhatsApp community groups, on the same daily schedule as GroupMe. Uses a dedicated WhatsApp number linked to this app -- an unofficial connection, so see the Admin Guide before turning it on.",
    defaultEnabled: false,
    group: "admin",
    section: "communications",
  },
  // Listed last because it builds on outboundEmail.
  publicPrayerDigest: {
    label: "Public prayer digest",
    description:
      "Lets anyone subscribe (no login) to email digests of prayer-request updates, for all partners or specific ones they follow -- unlike the admin digest above, this is prayer requests only, never one-time needs or newsletters. Also requires Public directory and Email (Sending) to be on.",
    defaultEnabled: false,
    group: "admin",
    section: "communications",
  },
  // A lead plus members per partner who keep in touch with it. Terms are fixed
  // defaults, not ChurchSettings fields. Off by default.
  // A log of every touchpoint with a partner, a contact card, a "My partners" view
  // and a "needs reaching out" alert. Off by default.
  contactLog: {
    label: "Contact log",
    description:
      "Record every call, text, email, visit or card with a partner, show a contact card on each partner page, flag partners nobody has been in touch with lately, and add an My partners view for care team members.",
    defaultEnabled: false,
    group: "admin",
  },
  // A bell alert and grouped daily email for a care team when a birthday,
  // anniversary or supported-since milestone is coming. Needs care teams; the email needs email sending.
  keyDates: {
    label: "Key-date reminders",
    description:
      "Remind each partner's care team about coming birthdays (including children), anniversaries and supported-since milestones: on the bell, and in one grouped email a day that is sent only on days something is due. Needs Care teams; the email also needs Email (Sending).",
    defaultEnabled: false,
    group: "admin",
  },
  careTeam: {
    label: "Care teams",
    description:
      "Give each partner a care team: one lead plus members from your logins who keep in touch with them. Guests can be given a partner this way. Also adds a coverage report of partners with no care team.",
    defaultEnabled: false,
    group: "admin",
  },
  // A church-owned menu of ways to support a partner (edited in Settings, never
  // code) and each partner's choices from it. Needs Care teams. Off by default.
  supportPreferences: {
    label: "Support preferences",
    description:
      "Let each partner choose how the church and their care team can support them (a menu you edit under Settings, such as housing while home, airport pick-up, prayer, care packages), shown as a card on the partner's page and recorded by staff or the care team. Needs Care teams. Never shown publicly, in the booklet or in dispatches.",
    defaultEnabled: false,
    group: "admin",
  },
  auditTrail: {
    label: "Audit log",
    description:
      "On by default. Records who did what and when for sensitive actions (sign-ins with their IP address, role and access changes, settings changes, deletes, backups, views of restricted partners), with an admin-only Audit log page and CSV export. Events are kept for the retention window set under Audit log (30, 60 or 90 days); who last edited a record is kept for good.",
    defaultEnabled: true,
    group: "admin",
  },
  aiExtraction: {
    label: "AI Features",
    description:
      "Scan uploaded newsletters and email documents for prayer requests and one-time needs using Claude.",
    defaultEnabled: false,
    group: "admin",
    section: "integrations",
  },
  // One switch for the whole integration; where it shows (public, admin, or both)
  // is a setting on the Joshua Project page, not another entry. Off by default until an API key is configured.
  joshuaProject: {
    label: "Joshua Project stats",
    description:
      "Show country-level unreached-people-group statistics on a partner's page. Turning this on after partners already exist? The Country Code (FIPS) field on Serving Location only appears once this is on, so existing partners won't have a code yet -- open each one's Serving Location and either enter it manually or clear and re-enter the Country field to trigger the auto-lookup.",
    defaultEnabled: false,
    group: "admin",
    section: "integrations",
  },
};

const FEATURE_KEYS = Object.keys(FEATURES);

// A key with no entry in enabledFeatures falls back to its registry default:
// existing deployments keep current features on, and a new feature like
// aiExtraction stays off until enabled.
function isFeatureEnabled(enabledFeatures, key) {
  const feature = FEATURES[key];
  if (!feature) return false;
  const stored = enabledFeatures?.[key];
  const on = typeof stored === "boolean" ? stored : feature.defaultEnabled;
  return on;
}

// The public data routes back both the directory and map (and the detail page
// links from either), so they stay reachable while at least one is on.
function isAnyFeatureEnabled(enabledFeatures, keys) {
  return keys.some((key) => isFeatureEnabled(enabledFeatures, key));
}

module.exports = { FEATURES, FEATURE_KEYS, isFeatureEnabled, isAnyFeatureEnabled };
