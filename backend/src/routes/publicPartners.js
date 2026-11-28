const express = require("express");
const prisma = require("../prismaClient");
const { toPublicPartner, MASK_NAME_SELECT } = require("../utils/maskData");
const { shapeSendingParties } = require("../utils/sendingParty");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
// Backs the directory, map and partner-detail pages; reachable while at least one is on (see
// isAnyFeatureEnabled in utils/features.js).
router.use(requireFeature(["publicDirectory", "publicMap"]));

// Everything the public serializer needs, and nothing more. The missionary-only relations come
// back empty for an organization, so one include serves both kinds.
//
// adults/children are never exposed: missionaryHouseholdCategory (utils/maskData.js) reads only
// their `.length` to pick a *restricted* missionary's generic silhouette. So they select only an
// id; `adults: true` would load a spouse's phone/email and each child's name and birthday on an
// UNAUTHENTICATED request, one careless `...partner` spread from a leak.
const publicInclude = {
  adults: { select: { id: true } },
  children: { select: { id: true } },
  sendingParties: true,
  addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
  // Only the current (most recently received) photo is ever surfaced publicly, never the history.
  photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1 },
  links: { select: { type: true, url: true } },
  languages: { select: { language: true, proficiency: true } },
};

// GET /api/public/partners?kind=missionary|organization — the curated/masked list. Every record
// goes through toPublicPartner; no public route may bypass it.
// The only ChurchSettings field toPublicPartner() needs, shared by both routes below.
async function getRestrictedMaskingSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { restrictedPartnerInitialsEnabled: true },
  });
}

// A restricted partner is shown as initials, and for a missionary household those come from its adults. Their names
// are loaded here, for restricted records only, and used only to make those initials (toPublicPartner never puts
// an adult in its response; the public tests check that no adult name appears).
async function withMaskNames(records) {
  const restricted = records.filter((p) => p?.isRestricted);
  if (restricted.length === 0) return records;
  const adults = await prisma.adult.findMany({
    where: { partnerId: { in: restricted.map((p) => p.id) } },
    select: { partnerId: true, ...MASK_NAME_SELECT.adults.select },
  });
  const byPartner = new Map();
  for (const adult of adults) {
    byPartner.set(adult.partnerId, [...(byPartner.get(adult.partnerId) || []), adult]);
  }
  return records.map((p) => (p?.isRestricted ? { ...p, adults: byPartner.get(p.id) || [] } : p));
}

router.get("/", async (req, res, next) => {
  try {
    const where = { isPublic: true, archived: false };
    if (req.query.kind) where.kind = String(req.query.kind);

    const [records, settings] = await Promise.all([
      prisma.partner.findMany({
        where,
        include: publicInclude,
        orderBy: { displayName: "asc" },
      }),
      getRestrictedMaskingSettings(),
    ]);

    const publicList = (await withMaskNames(records))
      .map(shapeSendingParties)
      .map((p) => toPublicPartner(p, settings))
      .filter(Boolean);
    res.json(publicList);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/partners/:id
router.get("/:id", async (req, res, next) => {
  try {
    const [record, settings] = await Promise.all([
      prisma.partner.findUnique({
        where: { id: req.params.id },
        include: publicInclude,
      }),
      getRestrictedMaskingSettings(),
    ]);

    const [named] = record ? await withMaskNames([record]) : [record];
    const publicRecord = toPublicPartner(shapeSendingParties(named), settings);
    if (!publicRecord) return res.status(404).json({ error: "Not found" });
    res.json(publicRecord);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
