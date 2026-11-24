const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const {
  requireAuth,
  requireRole,
  requirePartnerQueryScope,
  requirePartnerWriter,
} = require("../middleware/requireAuth");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { LINK_TYPES } = require("./linkTypes");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// The only writer for PartnerLink -- see routes/adults.js for the full
// reasoning, same shape, no consolidated cross-partner list. `type` is a
// fixed set (see linkTypes.js), enforced here so a bad value fails loudly
// instead of silently storing an unrecognized platform.
const partnerLinkSchema = z.object({
  partnerId: z.string(),
  type: z.enum(LINK_TYPES),
  url: z.string().min(1),
});

const partnerLinkInclude = { partner: partnerRefSelect };

// GET /api/partner-links?partnerId=
router.get("/", requirePartnerQueryScope, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.partnerLink.findMany({
      where,
      include: partnerLinkInclude,
      orderBy: [{ createdAt: "asc" }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/partner-links  (create — editor or admin)
// @@unique([partnerId, type]) means a second link of a type already on
// file 400s with a plain Prisma unique-constraint error -- the UI offers
// only the partner's remaining unused types, so this is a true conflict,
// not an expected path.
router.post("/", requirePartnerWriter({ body: true }), async (req, res, next) => {
  try {
    const data = partnerLinkSchema.parse(req.body);
    const created = await prisma.partnerLink.create({ data, include: partnerLinkInclude });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/partner-links/:id  (update — editor or admin)
router.put("/:id", requirePartnerWriter({ model: "partnerLink" }), async (req, res, next) => {
  try {
    const data = partnerLinkSchema.partial().parse(req.body);
    const updated = await prisma.partnerLink.update({
      where: { id: req.params.id },
      data,
      include: partnerLinkInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/partner-links/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.partnerLink.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
