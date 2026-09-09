// Canonical registry of gate-able optional features -- the single source of
// truth for which `enabledFeatures` keys are valid (see the ChurchSettings
// model comment in schema.prisma). The frontend keeps its own copy of the
// label/description text for display (same pattern as the Document category
// labels in routes/documents.js) -- keep the two in sync by hand.
const FEATURES = {
  newsletters: {
    label: "Newsletters",
    description: "The newsletter archive on missionary/organization pages and its own admin section.",
    defaultEnabled: true,
  },
  documents: {
    label: "Documents",
    description: "The general document repo (survey responses, signed policies, etc.).",
    defaultEnabled: true,
  },
  publicDirectory: {
    label: "Public directory",
    description: "The public list/search view at the site's root (\"/\"). Turning this off shows a private-instance message there instead.",
    defaultEnabled: true,
  },
  publicMap: {
    label: "Public map",
    description: "The public map view (\"/map\"). Turning this off shows a private-instance message there instead.",
    defaultEnabled: true,
  },
  aiExtraction: {
    label: "AI request scanning",
    description: "Scan uploaded newsletters and email documents for prayer requests and one-time needs using Claude. Requires ANTHROPIC_API_KEY to be configured.",
    defaultEnabled: false,
    requiresEnvVar: "ANTHROPIC_API_KEY",
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
  if (!on) return false;
  if (feature.requiresEnvVar && !process.env[feature.requiresEnvVar]) return false;
  return true;
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
