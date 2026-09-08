const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user

// Free-standing CRUD for the consolidated "Prayer Requests" admin page,
// same shape as routes/supportNeeds.js. `status` has no "unanswered"
// value on purpose (see the PrayerRequest model comment in
// schema.prisma) -- "ongoing" is the neutral default, not a flag that
// something failed to happen.
const prayerRequestBaseSchema = z.object({
  missionaryId: z.string().optional().nullable(),
  organizationId: z.string().optional().nullable(),
  category: z.enum(["short_term", "long_term"]),
  requestText: z.string().min(1),
  dateReceived: z.coerce.date(),
  isPublic: z.boolean().optional(),
  status: z.enum(["ongoing", "answered", "untracked"]).optional(),
  dateAnswered: z.coerce.date().optional().nullable(),
  answeredNote: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const createPrayerRequestSchema = prayerRequestBaseSchema.refine(
  (data) => Boolean(data.missionaryId) !== Boolean(data.organizationId),
  { message: "Exactly one of missionaryId or organizationId is required", path: ["missionaryId"] }
);

const prayerRequestInclude = {
  missionary: { select: { id: true, displayName: true } },
  organization: { select: { id: true, name: true } },
};

// GET /api/prayer-requests  (all entities combined, newest received first)
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.prayerRequest.findMany({
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
    const data = createPrayerRequestSchema.parse(req.body);
    const created = await prisma.prayerRequest.create({
      data: { ...data, createdById: req.user.id },
      include: prayerRequestInclude,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// PUT /api/prayer-requests/:id  (update — editor or admin)
// Mainly for recording an answer (status/dateAnswered/answeredNote) on a
// previously-ongoing request, but allows editing any field. Doesn't
// accept re-parenting to a different missionary/organization from this
// endpoint — only the fields below are ever applied.
router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { missionaryId, organizationId, ...rest } = prayerRequestBaseSchema.partial().parse(req.body);
    const updated = await prisma.prayerRequest.update({
      where: { id: req.params.id },
      data: rest,
      include: prayerRequestInclude,
    });
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
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
