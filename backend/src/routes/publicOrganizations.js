const express = require("express");
const prisma = require("../prismaClient");
const { toPublicOrganization } = require("../utils/maskData");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireFeature("publicSite"));

// GET /api/public/organizations
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.organization.findMany({
      where: { isPublic: true, archived: false },
      include: {
        addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
        // Only long-term requests an admin explicitly marked public — see
        // the PrayerRequest model comment in schema.prisma.
        prayerRequests: { where: { category: "long_term", isPublic: true }, orderBy: { dateReceived: "desc" } },
        // Only the current photo (most recently received) is ever surfaced
        // publicly — never the upload history.
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1, omit: { bytes: true } },
      },
      orderBy: { name: "asc" },
    });

    const publicList = records.map(toPublicOrganization).filter(Boolean);
    res.json(publicList);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/organizations/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        addresses: { where: { type: "physical" } },
        prayerRequests: { where: { category: "long_term", isPublic: true }, orderBy: { dateReceived: "desc" } },
        // Was missing here (present on the list route above) -- an
        // organization's public detail page could never show a photo.
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1, omit: { bytes: true } },
      },
    });

    const publicRecord = toPublicOrganization(record);
    if (!publicRecord) return res.status(404).json({ error: "Not found" });
    res.json(publicRecord);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
