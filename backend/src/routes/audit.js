// The Audit log page's API (#341): read the audit trail, export it, and set how
// long it is kept. Admin only, and only while the auditTrail feature is on.
// Reading it is deliberately not itself logged -- that would make every look
// at the log add to it.
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { toCsv, csvFilename } = require("../utils/csv");
const { describeDetails } = require("../utils/auditDetails");
const { AUDIT_ACTIONS, RETENTION_CHOICES, retentionDays, recordAudit } = require("../utils/auditLog");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("admin"));
router.use(requireFeature("auditTrail"));

const PAGE_SIZE = 50;
const MAX_PAGE = 200;
const EXPORT_CAP = 50000;

// A form sends every filter, empty ones as "" -- treat that as "no filter", not
// as a value to validate.
const blankToUndefined = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());

const filterSchema = z.object({
  q: optional(z.string().trim().max(200)),
  category: optional(z.string().trim().max(60)),
  action: optional(z.string().trim().max(80)),
  from: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  to: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

// A calendar day in the church's timezone (the process TZ), start or end.
function dayStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function dayEnd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0);
}

function buildWhere(filters) {
  const and = [];
  if (filters.category) {
    const codes = Object.entries(AUDIT_ACTIONS)
      .filter(([, meta]) => meta.category === filters.category)
      .map(([code]) => code);
    and.push({ action: { in: codes } });
  }
  if (filters.action) and.push({ action: filters.action });
  if (filters.from) and.push({ createdAt: { gte: dayStart(filters.from) } });
  if (filters.to) and.push({ createdAt: { lt: dayEnd(filters.to) } });
  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" };
    and.push({
      OR: [
        { actorEmail: contains },
        { actorName: contains },
        { targetEmail: contains },
        { targetName: contains },
        { entityLabel: contains },
        { ip: contains },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

const person = (id, email, name, existing) =>
  id || email || name ? { id, email, name: name || email, deleted: Boolean(id) && !existing.has(id) } : null;

// Rows as the page and the export both want them: the action's label and
// category, who and about whom (flagged when that account no longer exists),
// and the details as one readable line.
async function shapeRows(rows) {
  const ids = [...new Set(rows.flatMap((r) => [r.actorUserId, r.targetUserId]).filter(Boolean))];
  const existing = new Set(
    ids.length
      ? (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id)
      : []
  );
  return rows.map((r) => {
    const meta = AUDIT_ACTIONS[r.action] || { label: r.action, category: "Other" };
    return {
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      label: meta.label,
      category: meta.category,
      actor: person(r.actorUserId, r.actorEmail, r.actorName, existing),
      target: person(r.targetUserId, r.targetEmail, r.targetName, existing),
      entity: r.entityType ? { type: r.entityType, id: r.entityId, label: r.entityLabel } : null,
      ip: r.ip,
      summary: describeDetails(r.details),
    };
  });
}

// GET /api/audit?q&category&action&from&to&limit&cursor
router.get("/", async (req, res, next) => {
  try {
    const filters = filterSchema.parse(req.query);
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || PAGE_SIZE, MAX_PAGE);
    const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : null;
    const rows = await prisma.auditLog.findMany({
      where: buildWhere(filters),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({ rows: await shapeRows(page), nextCursor: hasMore ? page[page.length - 1].id : null });
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/export -- the same filters, as CSV, newest first.
router.get("/export", async (req, res, next) => {
  try {
    const filters = filterSchema.parse(req.query);
    const rows = await prisma.auditLog.findMany({
      where: buildWhere(filters),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: EXPORT_CAP,
    });
    const shaped = (await shapeRows(rows)).map((r) => ({
      when: r.createdAt.toISOString(),
      who: r.actor ? `${r.actor.name || ""}${r.actor.deleted ? " (deleted account)" : ""}` : "",
      whoEmail: r.actor?.email || "",
      action: r.label,
      aboutPerson: r.target ? `${r.target.name || ""}${r.target.deleted ? " (deleted account)" : ""}` : "",
      aboutEmail: r.target?.email || "",
      record: r.entity ? [r.entity.type, r.entity.label].filter(Boolean).join(": ") : "",
      details: r.summary,
      ip: r.ip || "",
    }));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${csvFilename("audit-log")}"`);
    res.send(
      toCsv(shaped, [
        { key: "when", label: "When (UTC)" },
        { key: "who", label: "Who" },
        { key: "whoEmail", label: "Who (email)" },
        { key: "action", label: "What" },
        { key: "aboutPerson", label: "About (person)" },
        { key: "aboutEmail", label: "About (email)" },
        { key: "record", label: "Record" },
        { key: "details", label: "Details" },
        { key: "ip", label: "IP address" },
      ])
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/meta -- what the filters offer, and the retention setting.
router.get("/meta", async (req, res, next) => {
  try {
    const [settings, total, oldest] = await Promise.all([
      prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { auditRetentionDays: true } }),
      prisma.auditLog.count(),
      prisma.auditLog.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    const categories = [...new Set(Object.values(AUDIT_ACTIONS).map((a) => a.category))];
    res.json({
      categories,
      actions: Object.entries(AUDIT_ACTIONS).map(([code, a]) => ({
        code,
        label: a.label,
        category: a.category,
      })),
      retentionDays: retentionDays(settings?.auditRetentionDays),
      retentionChoices: RETENTION_CHOICES,
      total,
      oldest: oldest?.createdAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/audit/retention { days } -- 30, 60 or 90.
router.put("/retention", async (req, res, next) => {
  try {
    const { days } = z.object({ days: z.number().int() }).parse(req.body);
    if (!RETENTION_CHOICES.includes(days)) {
      return res.status(400).json({ error: `Keep the log for ${RETENTION_CHOICES.join(", ")} days` });
    }
    const previous = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { auditRetentionDays: true },
    });
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { auditRetentionDays: days },
      create: { id: "singleton", auditRetentionDays: days },
    });
    await recordAudit(null, {
      action: "settings.updated",
      actor: req.user,
      entity: { type: "settings", label: "audit log retention" },
      req,
      details: { retentionDays: { from: retentionDays(previous?.auditRetentionDays), to: days } },
    });
    res.json({ retentionDays: days });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
