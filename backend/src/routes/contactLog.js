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
} = require("../utils/contactLog");
const { careTimings } = require("../utils/careSettings");
const { loadAssignedPartners, loadUpdatesToPassOn } = require("../utils/contactLogQueries");

// The partner contact log. Gated by the `contactLog` feature (404 when off,
// data kept).
//
// Anyone who can see the partner can log a contact: admin, editor, viewer, and
// a guest with a care team seat on that partner. A trip leader never reaches
// it, the same line as one-time needs. Fixing or deleting is admin/editor.
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
  supportOptionId: z.string().min(1).optional().nullable(),
});

// Fallback "today" (UTC calendar day) when the client sends no local date.
function today() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

// Checks the optional pieces an entry can point at, so one partner's entry
// can't be attached to another partner's need or login that doesn't exist.
async function checkReferences(data, partnerId, user) {
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
  if (data.supportOptionId) {
    const o = await prisma.supportOption.findUnique({
      where: { id: data.supportOptionId },
      select: { id: true, label: true, staffOnly: true },
    });
    if (!o || (o.staffOnly && user?.role === "guest")) return "That support option doesn't exist";
    data.supportOptionLabel = o.label;
  } else if (data.supportOptionId === null) {
    data.supportOptionLabel = null;
  }
  return null;
}

// GET /api/contact-log/options -- the fixed lists, so the frontend keeps no
// copy of its own.
router.get("/options", async (req, res, next) => {
  try {
    res.json({
      types: CONTACT_TYPES,
      directions: DIRECTIONS,
      topics: TOPICS,
      staleDays: (await careTimings()).contactStaleDays,
    });
  } catch (err) {
    next(err);
  }
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

// GET /api/contact-log/timeline?partnerId= -- church visits and newsletters
// shown alongside log entries, newest first. Read from the source records at
// request time, never copied into the log, so edits and deletes can't leave a
// stale copy.
router.get("/timeline", async (req, res, next) => {
  try {
    const partnerId = String(req.query.partnerId || "");
    if (!partnerId) return res.status(400).json({ error: "partnerId is required" });
    if (!canUse(req.user, partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    const [visits, newsletters] = await Promise.all([
      prisma.churchVisit.findMany({
        where: { partnerId },
        select: { id: true, visitDate: true, notes: true },
      }),
      prisma.partnerFile.findMany({
        where: { partnerId, kind: "newsletter" },
        select: { id: true, receivedDate: true, title: true, fileName: true },
      }),
    ]);
    const day = (d) => d.toISOString().slice(0, 10);
    const events = [
      ...visits.map((v) => ({
        id: `visit:${v.id}`,
        source: "visit",
        date: day(v.visitDate),
        title: "Visited the church",
        detail: v.notes || "",
      })),
      ...newsletters.map((n) => ({
        id: `newsletter:${n.id}`,
        source: "newsletter",
        date: day(n.receivedDate),
        title: "Newsletter filed",
        detail: n.title || n.fileName || "",
      })),
    ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// GET /api/contact-log/updates?partnerId= -- what is still waiting to be passed
// on (a decided need, an answered prayer); the same list the bell counts.
router.get("/updates", async (req, res, next) => {
  try {
    const partnerId = String(req.query.partnerId || "");
    if (!partnerId) return res.status(400).json({ error: "partnerId is required" });
    if (!canUse(req.user, partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    const items = await loadUpdatesToPassOn([partnerId]);
    res.json({
      updates: items
        .map(({ id, kind, date, label, topic }) => ({
          id,
          kind,
          date: date.toISOString().slice(0, 10),
          label,
          topic,
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/contact-log/all -- every entry this login may read, newest first, for the Contact Log
// page: optional partnerId, contactType, direction, topic and from/to dates, paged with limit (max
// 200) and offset. A guest only sees partners they hold a care team seat on, like the rest of the log.
router.get("/all", async (req, res, next) => {
  try {
    const q = z
      .object({
        partnerId: z.string().min(1).optional(),
        contactType: z.enum(CONTACT_TYPE_VALUES).optional(),
        direction: z.enum(DIRECTION_VALUES).optional(),
        topic: z.enum(TOPIC_VALUES).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional().default(50),
        offset: z.coerce.number().int().min(0).optional().default(0),
      })
      .parse(req.query);
    const reach = readableNeedPartnerIds(req.user);
    if (q.partnerId && !canUse(req.user, q.partnerId)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const where = {
      ...(q.partnerId ? { partnerId: q.partnerId } : reach ? { partnerId: { in: reach } } : {}),
      ...(q.contactType ? { contactType: q.contactType } : {}),
      ...(q.direction ? { direction: q.direction } : {}),
      ...(q.topic ? { topics: { has: q.topic } } : {}),
      ...(q.from || q.to
        ? { contactDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.contactLog.count({ where }),
      prisma.contactLog.findMany({
        where,
        include: { ...include, partner: { select: { id: true, displayName: true } } },
        orderBy: [{ contactDate: "desc" }, { createdAt: "desc" }],
        take: q.limit,
        skip: q.offset,
      }),
    ]);
    res.json({ rows, total, hasMore: q.offset + rows.length < total });
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

router.post("/", async (req, res, next) => {
  try {
    const data = entrySchema.parse(req.body);
    if (!canUse(req.user, data.partnerId)) return res.status(403).json({ error: "Insufficient permissions" });
    // Staff may log a contact on someone else's behalf; anyone else's is always their own.
    if (!["admin", "editor"].includes(req.user.role)) data.contactedById = req.user.id;
    const partner = await prisma.partner.findUnique({ where: { id: data.partnerId }, select: { id: true } });
    if (!partner) return res.status(404).json({ error: "Not found" });
    const problem = await checkReferences(data, data.partnerId, req.user);
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
    const problem = await checkReferences(data, existing.partnerId, req.user);
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
