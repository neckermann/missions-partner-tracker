// Canonical registry of gate-able optional features -- the single source of
// truth for which `enabledFeatures` keys are valid (see the ChurchSettings
// model comment in schema.prisma). The label and description travel to the
// frontend with the settings payload (routes/settings.js), so the Features
// page renders whatever is written here -- there is no second copy to keep
// in sync. Adding a feature is adding an entry here.
//
// `group` is "public" for the two toggles a logged-out visitor can actually
// notice (the site disappearing/reappearing at "/" or "/map") and "admin"
// for everything else, which only ever changes what a logged-in admin sees
// in their own nav -- drives the Public site/Admin features split in
// pages/AdminSettingsFeatures.jsx. Order within "admin" mirrors the nav's
// own grouping (AdminSidebar.jsx/AdminHome.jsx): core content features
// first, then Communications (send and/or receive), then Integrations
// (pull data in / process content, never communicate with anyone) --
// `section` ("communications" | "integrations" | omitted for core) is
// what further splits the Admin features list into those same three
// visual blocks on that page, so it reads the same way the nav does.
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
  trips: {
    label: "Mission trips",
    description: "The Trip History and Trip Opportunities pages.",
    defaultEnabled: true,
    group: "admin",
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
      "Read-only reports over existing data — birthdays, monthly support, one-time needs, prayer requests, trip history, furlough — with CSV download and a print view.",
    defaultEnabled: true,
    group: "admin",
  },
  // Outbound sending capability (see #71) and its matching inbound half
  // (see #72) -- two independent flags on purpose, not one: a church may
  // want only one direction. They share a single settings page
  // (Site Administration -> Email) since it's one Postmark account, but
  // each flag gates its own routes independently (the send-test route
  // checks "outboundEmail" only; the inbound webhook/review-queue routes
  // check "inboundEmail" only) -- enabling one never requires or unlocks
  // the other. Off by default, same "off until it does something"
  // reasoning as every other integration here.
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
    label: "GroupMe notifications",
    description:
      "Post new prayer requests, one-time needs, and newsletters to their own configured GroupMe Topics as they're added.",
    defaultEnabled: false,
    group: "admin",
    section: "communications",
  },
  // Listed last -- unlike the three toggles above (each independently
  // useful on its own), this one builds on top of outboundEmail (and
  // publicDirectory, elsewhere), so it reads better after the thing it
  // depends on rather than sandwiched in the middle of the Email pair.
  publicPrayerDigest: {
    label: "Public prayer digest",
    description:
      "Lets anyone subscribe (no login) to email digests of prayer-request updates, for all partners or specific ones they follow -- unlike the admin digest above, this is prayer requests only, never one-time needs or newsletters. Also requires Public directory and Email (Sending) to be on.",
    defaultEnabled: false,
    group: "admin",
    section: "communications",
  },
  aiExtraction: {
    label: "AI Features",
    description:
      "Scan uploaded newsletters and email documents for prayer requests and one-time needs using Claude.",
    defaultEnabled: false,
    group: "admin",
    section: "integrations",
  },
  // One switch for the integration as a whole -- *where* it then shows
  // (public partner pages, admin partner pages, or both) is a plain
  // setting on the Joshua Project settings page itself, not a
  // second/third feature-registry entry, since it's display placement
  // rather than something with its own nav/page to hide. Off by default
  // until an API key is configured, same reasoning as groupme.
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

// A key with no explicit entry in enabledFeatures falls back to its
// registry default -- so existing deployments upgrading onto this column
// (which defaults to `{}`) keep every current feature turned on, and a
// brand-new feature like aiExtraction stays off until deliberately enabled.
function isFeatureEnabled(enabledFeatures, key) {
  const feature = FEATURES[key];
  if (!feature) return false;
  const stored = enabledFeatures?.[key];
  const on = typeof stored === "boolean" ? stored : feature.defaultEnabled;
  return on;
}

// The public missionary/organization data routes back both the directory
// and map pages (same underlying list -- see PublicDirectory.jsx and
// PublicMap.jsx), and the partner-detail page is linked from either one --
// so that data stays reachable as long as at least one of the two is on,
// only 404ing once a church has turned off both.
function isAnyFeatureEnabled(enabledFeatures, keys) {
  return keys.some((key) => isFeatureEnabled(enabledFeatures, key));
}

module.exports = { FEATURES, FEATURE_KEYS, isFeatureEnabled, isAnyFeatureEnabled };
