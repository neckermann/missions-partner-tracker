const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Gates the whole resource. The partner record's own PUT no longer accepts
// a trips array, so this router is the only way in -- turning the feature
// off now actually turns it off.
router.use(requireFeature("trips"));

// The only writer for Trip (+ its TripParticipant children). Backs both the
// consolidated "Trip History" admin page and the trips section on a single
// partner's page -- logging or correcting a trip against any partner
// without loading and resubmitting their whole record.
const participantSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional().nullable(),
  isLeader: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

const tripSchema = z.object({
  partnerId: z.string(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  tripType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  participants: z.array(participantSchema).optional(),
});

const tripInclude = {
  partner: { select: { id: true, kind: true, displayName: true } },
  participants: true,
};

// GET /api/trips?partnerId=&tripType=&year=  (all partners combined,
// most recent first). Previously the Trip History page had to fetch every
// missionary and every organization with all their relations and flatten
// the result in the browser; this replaces that with one query.
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.partnerId) where.partnerId = String(req.query.partnerId);
    if (req.query.tripType) where.tripType = String(req.query.tripType);
    if (req.query.year) {
      const year = Number(req.query.year);
      if (Number.isInteger(year)) {
        where.startDate = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
      }
    }

    const records = await prisma.trip.findMany({
      where,
      include: tripInclude,
      orderBy: { startDate: "desc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/trips  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = tripSchema.parse(req.body);
    const created = await prisma.trip.create({
      data: {
        ...data,
        participants: participants?.length ? { create: participants } : undefined,
      },
      include: tripInclude,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues });
    next(err);
  }
});

// PUT /api/trips/:id  (update — editor or admin). Every field is editable,
// including moving the trip to a different partner, which is now just a
// plain column. Participants, when included in the request, are replaced
// wholesale (delete then recreate) rather than diffed -- simpler than
// tracking which participant row is "the same person" across an edit, and
// they carry nothing (no id references, no timestamps) that recreating
// them loses.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = tripSchema.partial().parse(req.body);

    const existing = await prisma.trip.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      if (participants !== undefined) {
        await tx.tripParticipant.deleteMany({ where: { tripId: req.params.id } });
      }
      return tx.trip.update({
        where: { id: req.params.id },
        data: {
          ...data,
          participants: participants !== undefined ? { create: participants } : undefined,
        },
        include: tripInclude,
      });
    });
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues });
    next(err);
  }
});

// DELETE /api/trips/:id  (admin only). Cascades to its participants.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.trip.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    await prisma.trip.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
