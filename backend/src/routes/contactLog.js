const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { readableNeedPartnerIds, isCareTeamEnabled } = require("../utils/guestAccess");
const {
  CONTACT_TYPES,
  DIRECTIONS,
  TOPICS,
  CONTACT_TYPE_VALUES,
  DIRECTION_VALUES,
  TOPIC_VALUES,
  CONTACT_STALE_DAYS,
} = require("../utils/contactLog");
const { loadAssignedPartners } = require("../utils/contactLogQueries");

// #288: the partner contact log. Gated by the `contactLog` feature (404 when
// off, data kept).
//
// Who: anyone who can see the partner can log a contact -- admin, editor,
// viewer, and a guest who holds a care team seat on that partner. A trip
// leader (a trip grant only) has a much smaller scope and never reaches it,
// the same line as one-time needs. Fixing or deleting an entry is admin/editor.
// Everyone's contact counts toward the "gone quiet" clock.
const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("contactLog"));
router.use(requireRole("admin", "editor", "viewer", "guest"));

// Same rule as one-time needs: null reach (every full role) or the partners a
// guest holds a seat on.
function canUse(user, partnerId) {
  const ids = readableNeedPartnerIds(user);
  return ids === null || ids.includes(partnerId);
}

const person = { select: { id: true, firstName: true, lastName: true } };
const include = { contactedBy: person, createdBy: person };

const day = z.coerce.date();
const entrySchema = z.object({
  partnerId: z.string().min(1),
  contactType: z.enum(CONTACT_TYPE_VALUES),
  direction: z.enum(DIRECTION_VALUES),
  topics: z.array(z.enum(TOPIC_VALUES)).max(TOPIC_VALUES.length).optional(),
  contactedById: z.string().min(1).optional().nullable(),
  contactDate: day.optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
  followUpDate: day.optional().nullable(),
  prayerRequestId: z.string().min(1).optional().nullable(),
  supportNeedId: z.string().min(1).optional().nullable(),
});

// Today as a calendar day. A client sends the viewer's local date; this is
// only the fallback when it sends none.
function today() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

// Checks the optional pieces an entry can point at, so one partner's entry
// can't be attached to another partner's need or login that doesn't exist.
async function checkReferences(data, partnerId) {
  if (data.contactedById) {
    const u = await prisma.user.findFirst({
      where: { id: data.contactedById, active: true },
      select: { id: true },
    });
    if (!u) return "That person doesn't have an active login";
  }
  if (data.supportNeedId) {
    const n = await prisma.supportNeed.findFirst({
      where: { id: data.supportNeedId, partnerId },
      select: { id: true },
    });
    if (!n) return "That need isn't on this partner";
  }
  if (data.prayerRequestId) {
    const r = await prisma.prayerRequest.findFirst({
      where: { id: data.prayerRequestId, partnerId },
      select: { id: true },
    });
    if (!r) return "That prayer request isn't on this partner";
  }
  return null;
}

// GET /api/contact-log/options -- the fixed lists, so the frontend keeps no
// copy of its own.
router.get("/options", (req, res) => {
  res.json({
    types: CONTACT_TYPES,
    directions: DIRECTIONS,
    topics: TOPICS,
    staleDays: CONTACT_STALE_DAYS,
  });
});

// GET /api/contact-log/assigned -- the partners this login holds a care team
// seat on, with care columns. Needs the careTeam feature too: a seat is the
// thing it lists.
router.get("/assigned", async (req, res, next) => {
  try {
    if (!(await isCareTeamEnabled())) return res.status(404).json({ error: "Not found" });
    res.json(await loadAssignedPartners(req.user.id, today()));
  } catch (err) {
    next(err);
  }
});

// GET /api/contact-log?partnerId= -- newest first.
router.get("/", async (req, res, next) => {
  try {
    const partnerId = String(req.query.partnerId || "");
    if (!partnerId) return res.status(400).json({ error: "partnerId is required" });
    if (!canUse(req.user, partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    const rows = await prisma.contactLog.findMany({
      where: { partnerId },
      include,
      orderBy: [{ contactDate: "desc" }, { createdAt: "desc" }],
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/contact-log
router.post("/", async (req, res, next) => {
  try {
    const data = entrySchema.parse(req.body);
    if (!canUse(req.user, data.partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    const partner = await prisma.partner.findUnique({ where: { id: data.partnerId }, select: { id: true } });
    if (!partner) return res.status(404).json({ error: "Not found" });
    const problem = await checkReferences(data, data.partnerId);
    if (problem) return res.status(400).json({ error: problem });

    const created = await prisma.contactLog.create({
      data: {
        ...data,
        topics: [...new Set(data.topics || [])],
        contactDate: data.contactDate || today(),
        contactedById: data.contactedById || req.user.id,
        createdById: req.user.id,
      },
      include,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/contact-log/:id -- admin/editor fix an entry. The partner can't be
// moved: an entry is history of one relationship.
const { partnerId: _ignored, ...updatableFields } = entrySchema.shape;
const updateSchema = z.object(updatableFields).partial();

router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const existing = await prisma.contactLog.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    const data = updateSchema.parse(req.body);
    const problem = await checkReferences(data, existing.partnerId);
    if (problem) return res.status(400).json({ error: problem });
    const updated = await prisma.contactLog.update({
      where: { id: existing.id },
      data: { ...data, ...(data.topics ? { topics: [...new Set(data.topics)] } : {}) },
      include,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/contact-log/:id
router.delete("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const existing = await prisma.contactLog.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    await prisma.contactLog.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
