const express = require("express");
const prisma = require("../prismaClient");

const router = express.Router();

// GET /api/public/settings
// Always returns a fixed-shape object with safe defaults, even before the
// church has configured anything, so an unconfigured instance renders
// identically to a hardcoded single-church app. Address/phone/contact
// fields are deliberately withheld here — those stay admin-only, same
// principle as toPublicMissionary/toPublicOrganization in maskData.js.
router.get("/", async (req, res, next) => {
  try {
    // logoContentType (not logoBytes) signals presence — see the comment
    // on shapeSettings in routes/settings.js for why.
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      omit: { logoBytes: true },
    });
    res.json({
      churchName: settings?.churchName || null,
      logo: settings?.logoContentType ? { url: "/api/public/settings/logo/raw" } : null,
      primaryColor: settings?.primaryColor || null,
      partnerTermSingular: settings?.partnerTermSingular || "Missionary",
      partnerTermPlural: settings?.partnerTermPlural || "Missionaries",
      usePartnerTermInAdmin: settings?.usePartnerTermInAdmin || false,
      publicTagline: settings?.publicTagline || null,
      aboutText: settings?.aboutText || null,
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
      select: { logoBytes: true, logoContentType: true },
    });
    if (!settings?.logoBytes) return res.status(404).end();

    res.set("Cache-Control", "public, max-age=60"); // short TTL -- unlike a Photo row, this one row's logo can change in place
    res.set("Content-Type", settings.logoContentType || "application/octet-stream");
    res.send(settings.logoBytes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
