const express = require("express");
const prisma = require("../prismaClient");
const { FEATURE_KEYS, isFeatureEnabled } = require("../utils/features");

const router = express.Router();

// GET /api/public/settings
// Always returns a fixed-shape object with safe defaults, even before the
// church has configured anything, so an unconfigured instance renders
// identically to a hardcoded single-church app. Address/phone/contact
// fields are deliberately withheld here — those stay admin-only, same
// principle as toPublicMissionary/toPublicOrganization in maskData.js.
router.get("/", async (req, res, next) => {
  try {
    // logoContentType (not the logo's bytes) signals presence — see the
    // comment on shapeSettings in routes/settings.js for why. The bytes
    // live in their own table now, never selected here at all.
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
    });
    res.json({
      churchName: settings?.churchName || null,
      logo: settings?.logoContentType ? { url: "/api/public/settings/logo/raw" } : null,
      primaryColor: settings?.primaryColor || null,
      headerColor: settings?.headerColor || null,
      highlightColor: settings?.highlightColor || null,
      brandFont: settings?.brandFont || null,
      partnerTermSingular: settings?.partnerTermSingular || "Missionary",
      partnerTermPlural: settings?.partnerTermPlural || "Missionaries",
      usePartnerTermInAdmin: settings?.usePartnerTermInAdmin || false,
      publicTagline: settings?.publicTagline || null,
      aboutText: settings?.aboutText || null,
      // Which of the three email-digest cadence tiers an admin has chosen
      // to offer (#209) -- exposed here, unauthenticated, specifically so
      // the public Subscribe page / "follow this partner" form (both
      // reached by a logged-out visitor) can filter their own cadence
      // picker down to only these, same reasoning enabledFeatures below
      // is public. Defaults mirror ChurchSettings' own column defaults so
      // an unconfigured instance behaves identically to one that's
      // explicitly saved these settings once.
      cadenceTiersEnabled: {
        biweekly: settings?.cadenceBiweeklyEnabled ?? false,
        monthly: settings?.cadenceMonthlyEnabled ?? true,
        quarterly: settings?.cadenceQuarterlyEnabled ?? true,
      },
      // Demo-mode banner, kept entirely separate from the real About
      // Church content above -- DEMO_RESET_TOKEN existing is already what
      // decides whether POST /api/demo/reset is even mounted (see
      // server.js), so it's reused here rather than adding a second
      // signal. The login credentials are the ones reset-demo-data.js
      // just (re)created, published on purpose: the whole point of a
      // public demo is letting a visitor actually try the admin
      // dashboard. Never set on a real deployment, since DEMO_RESET_TOKEN
      // never is.
      isDemo: Boolean(process.env.DEMO_RESET_TOKEN),
      demoLoginEmail: process.env.DEMO_RESET_TOKEN ? process.env.DEMO_ADMIN_EMAIL || null : null,
      demoLoginPassword: process.env.DEMO_RESET_TOKEN ? process.env.DEMO_ADMIN_PASSWORD || null : null,
      // Resolved (not raw) per-feature booleans -- reflects the registry
      // default, not just what's stored. Not sensitive (whether a feature
      // is on isn't a secret), and this is the one settings endpoint the
      // frontend always has access to (see context/SettingsContext.jsx),
      // so it's the natural place for it.
      enabledFeatures: Object.fromEntries(
        FEATURE_KEYS.map((key) => [key, isFeatureEnabled(settings?.enabledFeatures, key)])
      ),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/settings/logo/raw — public, unauthenticated, same
// reasoning as GET /api/photos/:id/raw (see routes/photos.js). No :id
// needed since there's only ever one church's logo (the singleton row).
router.get("/logo/raw", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { logoContentType: true, logoRow: { select: { logoBytes: true } } },
    });
    if (!settings?.logoRow) return res.status(404).end();

    // Same reasoning as photos.js's /:id/raw -- without this, helmet()'s
    // global same-origin Cross-Origin-Resource-Policy blocks a webmail
    // client from embedding this inline (#246).
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Cache-Control", "public, max-age=60"); // short TTL -- unlike a Photo row, this one row's logo can change in place
    res.set("Content-Type", settings.logoContentType || "application/octet-stream");
    res.send(settings.logoRow.logoBytes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
