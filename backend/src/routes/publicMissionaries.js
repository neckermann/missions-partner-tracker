const express = require("express");
const prisma = require("../prismaClient");
const { toPublicMissionary } = require("../utils/maskData");
const { shapeSendingParties } = require("../utils/sendingParty");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
// Backs both the directory and map pages, and the partner-detail page
// linked from either -- reachable as long as at least one is on (see
// isAnyFeatureEnabled's comment in utils/features.js).
router.use(requireFeature(["publicDirectory", "publicMap"]));

// GET /api/public/missionaries
// Returns the curated/masked list for the public website (map + list view)
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.missionary.findMany({
      where: { isPublic: true, archived: false },
      include: {
        adults: true,
        children: true,
        sendingParties: true,
        addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
        // Only long-term requests an admin explicitly marked public — see
        // the PrayerRequest model comment in schema.prisma. Filtered here
        // at the query level, not in maskData.js, so a short-term or
        // non-public request never leaves the database layer at all.
        prayerRequests: { where: { category: "long_term", isPublic: true }, orderBy: { dateReceived: "desc" } },
        // Only the current photo (most recently received) is ever surfaced
        // publicly — never the upload history.
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1, omit: { bytes: true } },
      },
      orderBy: { displayName: "asc" },
    });

    const publicList = records.map(shapeSendingParties).map(toPublicMissionary).filter(Boolean);
    res.json(publicList);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/missionaries/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.missionary.findUnique({
      where: { id: req.params.id },
      include: {
        adults: true,
        children: true,
        sendingParties: true,
        addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
        // Only long-term requests an admin explicitly marked public — see
        // the PrayerRequest model comment in schema.prisma. Filtered here
        // at the query level, not in maskData.js, so a short-term or
        // non-public request never leaves the database layer at all.
        prayerRequests: { where: { category: "long_term", isPublic: true }, orderBy: { dateReceived: "desc" } },
        // Only the current photo (most recently received) is ever surfaced
        // publicly — never the upload history.
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1, omit: { bytes: true } },
      },
    });

    const publicRecord = toPublicMissionary(shapeSendingParties(record));
    if (!publicRecord) return res.status(404).json({ error: "Not found" });
    res.json(publicRecord);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
