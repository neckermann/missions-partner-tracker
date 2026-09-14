const express = require("express");
const prisma = require("../prismaClient");
const { toPublicPartner } = require("../utils/maskData");
const { shapeSendingParties } = require("../utils/sendingParty");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
// Backs both the directory and map pages, and the partner-detail page
// linked from either -- reachable as long as at least one is on (see
// isAnyFeatureEnabled's comment in utils/features.js).
router.use(requireFeature(["publicDirectory", "publicMap"]));

// Everything the public serializer needs, and nothing it doesn't. The
// missionary-only relations (adults, children, sendingParties) come back
// empty for an organization, so one include serves both kinds.
//
// adults/children are fetched but never themselves exposed -- they only
// determine which generic household silhouette a *restricted* missionary
// gets (see missionaryHouseholdCategory in utils/maskData.js).
const publicInclude = {
  adults: true,
  children: true,
  sendingParties: true,
  addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
  // Only strategic requests an admin explicitly marked public — see the
  // PrayerRequest model comment in schema.prisma. Filtered here at the
  // query level, not in maskData.js, so a situational or non-public
  // request never leaves the database layer at all.
  prayerRequests: { where: { category: "strategic", isPublic: true }, orderBy: { dateReceived: "desc" } },
  // Only the current photo (most recently received) is ever surfaced
  // publicly — never the upload history.
  photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1, omit: { bytes: true } },
};

// GET /api/public/partners?kind=missionary|organization
// Returns the curated/masked list for the public website (map + list view).
// Every record goes through toPublicPartner -- no public route may bypass
// it, which is why the serializer is a pure function tested in isolation.
router.get("/", async (req, res, next) => {
  try {
    const where = { isPublic: true, archived: false };
    if (req.query.kind) where.kind = String(req.query.kind);

    const records = await prisma.partner.findMany({
      where,
      include: publicInclude,
      orderBy: { displayName: "asc" },
    });

    const publicList = records.map(shapeSendingParties).map(toPublicPartner).filter(Boolean);
    res.json(publicList);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/partners/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.partner.findUnique({
      where: { id: req.params.id },
      include: publicInclude,
    });

    const publicRecord = toPublicPartner(shapeSendingParties(record));
    if (!publicRecord) return res.status(404).json({ error: "Not found" });
    res.json(publicRecord);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
