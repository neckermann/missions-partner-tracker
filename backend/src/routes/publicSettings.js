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
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    res.json({
      churchName: settings?.churchName || null,
      logo: settings?.logo || null,
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

module.exports = router;
