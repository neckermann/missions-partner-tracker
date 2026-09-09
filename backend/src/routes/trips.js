const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Only gates this standalone CRUD path -- doesn't reach the nested
// missionTrips/orgTrips array inside routes/missionaries.js/organizations.js,
// which stays usable from a missionary/org's own edit form either way. Same
// narrower-gap situation as routes/supportNeeds.js.
router.use(requireFeature("trips"));

// Free-standing CRUD for Trip (+ its TripParticipant children), on top of
// the wholesale-replace missionTrips/orgTrips array already handled inside
// routes/missionaries.js and routes/organizations.js (used by each entity's
// own edit form). This is the API for the consolidated "Trip History"
// admin page -- logging or correcting a trip against any missionary/org
// without loading and resubmitting their whole record.
const participantSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional().nullable(),
  isLeader: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

const tripBaseSchema = z.object({
  missionaryId: z.string().optional().nullable(),
  organizationId: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  tripType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  participants: z.array(participantSchema).optional(),
});
const createTripSchema = tripBaseSchema.refine(
  (data) => Boolean(data.missionaryId) !== Boolean(data.organizationId),
  { message: "Exactly one of missionaryId or organizationId is required", path: ["missionaryId"] }
);

const tripInclude = {
  missionary: { select: { id: true, displayName: true } },
  organization: { select: { id: true, name: true } },
  participants: true,
};

// POST /api/trips  (create — editor or admin)
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = createTripSchema.parse(req.body);
    const created = await prisma.trip.create({
      data: {
        ...data,
        participants: participants?.length ? { create: participants } : undefined,
      },
      include: tripInclude,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// PUT /api/trips/:id  (update — editor or admin). Doesn't accept
// re-parenting to a different missionary/organization from this endpoint --
// same boundary as PUT /api/support-needs/:id. Participants, when included
// in the request, are always replaced wholesale (delete then recreate)
// rather than diffed -- same approach the missionary/organization's own
// bulk trip-array save already uses, and simpler than tracking which
// participant row is "the same person" across an edit.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, missionaryId, organizationId, ...data } = tripBaseSchema.partial().parse(req.body);

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
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
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
