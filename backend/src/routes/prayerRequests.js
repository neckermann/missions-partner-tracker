const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
router.use(requireFeature("prayerRequests"));

// The only writer for PrayerRequest, same shape as routes/supportNeeds.js.
// Backs both the consolidated "Prayer Requests" admin page and the prayer
// section on a single partner's page. `status` has no "unanswered" value on
// purpose (see the PrayerRequest model comment in schema.prisma) --
// "ongoing" is the neutral default, not a flag that something failed to
// happen.
const prayerRequestSchema = z.object({
  partnerId: z.string(),
  category: z.enum(["strategic", "situational"]),
  requestText: z.string().min(1),
  dateReceived: z.coerce.date(),
  isPublic: z.boolean().optional(),
  includeInBooklet: z.boolean().optional(),
  status: z.enum(["ongoing", "answered", "untracked"]).optional(),
  dateAnswered: z.coerce.date().optional().nullable(),
  answeredNote: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const prayerRequestInclude = {
  partner: { select: { id: true, kind: true, displayName: true } },
};

// GET /api/prayer-requests?partnerId=  (all partners combined, newest received first)
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);

    const records = await prisma.prayerRequest.findMany({
      where,
      include: prayerRequestInclude,
      orderBy: { dateReceived: "desc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/prayer-requests  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = prayerRequestSchema.parse(req.body);
    const created = await prisma.prayerRequest.create({
      data,
      include: prayerRequestInclude,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/prayer-requests/:id  (update — editor or admin)
// Mainly for recording an answer (status/dateAnswered/answeredNote) on a
// previously-ongoing request, but allows editing any field — including
// moving it to a different partner, which is now just a plain column and so
// needs no special handling.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = prayerRequestSchema.partial().parse(req.body);
    const updated = await prisma.prayerRequest.update({
      where: { id: req.params.id },
      data,
      include: prayerRequestInclude,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/prayer-requests/:id  (admin only)
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    await prisma.prayerRequest.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
