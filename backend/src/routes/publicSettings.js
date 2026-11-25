const express = require("express");
const prisma = require("../prismaClient");
const { demoGuestLogins } = require("../utils/demoLogins");
const { FEATURE_KEYS, isFeatureEnabled } = require("../utils/features");

const router = express.Router();

// GET /api/public/settings
// Always a fixed-shape object with safe defaults, so an unconfigured instance renders like a
// hardcoded single-church app. Address/phone/contact fields are deliberately withheld (admin-only),
// same principle as toPublicMissionary/toPublicOrganization in maskData.js.
router.get("/", async (req, res, next) => {
  try {
    // logoContentType (not the logo's bytes) signals presence; see shapeSettings in routes/settings.js.
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
      // The email-digest cadence tiers an admin offers (#209). Public so the logged-out Subscribe page
      // and "follow this partner" form can filter their cadence picker. Defaults mirror ChurchSettings'
      // column defaults.
      cadenceTiersEnabled: {
        biweekly: settings?.cadenceBiweeklyEnabled ?? false,
        monthly: settings?.cadenceMonthlyEnabled ?? true,
        quarterly: settings?.cadenceQuarterlyEnabled ?? true,
      },
      // Demo-mode banner, separate from the real About Church content. DEMO_RESET_TOKEN existing
      // already decides whether POST /api/demo/reset is mounted (server.js), so it is reused as the
      // signal. The logins are published on purpose so visitors can try the admin dashboard; never set
      // on a real deployment, since DEMO_RESET_TOKEN never is.
      isDemo: Boolean(process.env.DEMO_RESET_TOKEN),
      demoLoginEmail: process.env.DEMO_RESET_TOKEN ? process.env.DEMO_ADMIN_EMAIL || null : null,
      demoLoginPassword: process.env.DEMO_RESET_TOKEN ? process.env.DEMO_ADMIN_PASSWORD || null : null,
      // The other published demo logins (utils/demoLogins.js). Same demo-only gate; [] elsewhere.
      demoGuestLogins: process.env.DEMO_RESET_TOKEN ? demoGuestLogins() : [],
      // Resolved (not raw) per-feature booleans, reflecting the registry default. Not sensitive, and
      // this is the one settings endpoint the frontend always has access to (SettingsContext.jsx).
      enabledFeatures: Object.fromEntries(
        FEATURE_KEYS.map((key) => [key, isFeatureEnabled(settings?.enabledFeatures, key)])
      ),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/settings/logo/raw — public, unauthenticated, same reasoning as
// GET /api/photos/:id/raw (routes/photos.js). No :id: there is one logo (the singleton row).
router.get("/logo/raw", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { logoContentType: true, logoRow: { select: { logoBytes: true } } },
    });
    if (!settings?.logoRow) return res.status(404).end();

    // Same reason as photos.js /:id/raw: helmet()'s same-origin CORP would block webmail clients
    // from embedding this (#246).
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    // Short TTL: unlike a Photo row, the logo can change in place.
    res.set("Cache-Control", "public, max-age=60");
    res.set("Content-Type", settings.logoContentType || "application/octet-stream");
    res.send(settings.logoRow.logoBytes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
