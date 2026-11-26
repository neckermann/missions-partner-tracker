const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { listReports, getReport, runReport } = require("../reporting/registry");
const { toCsv, csvFilename } = require("../utils/csv");
const { resolveToday } = require("../utils/today");

const router = express.Router();

// Reads, so open to admin/editor/viewer (see ADMIN_GUIDE.md "Who can see
// what"); Trip Leader is a scoped guest and gets no cross-partner reports.
// A report may narrow this further with its own `roles`.
router.use(requireAuth);
router.use(requireRole("admin", "editor", "viewer"));
router.use(requireFeature("reports"));

async function accessFor(req) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return {
    role: req.user.role,
    isEnabled: (key) => isFeatureEnabled(settings?.enabledFeatures, key),
  };
}

// GET /api/reports -- the hub catalog (groups + report metadata, no data).
router.get("/", async (req, res, next) => {
  try {
    res.json(listReports(await accessFor(req)));
  } catch (err) {
    next(err);
  }
});

// Registered BEFORE "/:id" so "views" is never read as a report id.
const { z } = require("zod");

const viewSchema = z.object({
  reportId: z.string(),
  name: z.string().trim().min(1).max(80),
  params: z.record(z.string(), z.any()).default({}),
  shared: z.boolean().default(false),
});

const scheduleSchema = z.object({
  cadence: z.enum(["weekly", "monthly", "quarterly"]),
  recipientIds: z.array(z.string()).min(1).max(25),
  skipIfEmpty: z.boolean().default(true),
});

const viewInclude = { schedules: true };

// GET /api/reports/views?reportId= -- the caller's own views plus shared ones.
router.get("/views", async (req, res, next) => {
  try {
    const where = { OR: [{ ownerId: req.user.id }, { shared: true }] };
    if (req.query.reportId) where.reportId = String(req.query.reportId);
    res.json(await prisma.savedReport.findMany({ where, include: viewInclude, orderBy: { name: "asc" } }));
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/views -- params are validated through the report's own
// schema, so a saved view can never hold something the report would reject.
router.post("/views", async (req, res, next) => {
  try {
    const data = viewSchema.parse(req.body);
    const report = getReport(data.reportId, await accessFor(req));
    if (!report) return res.status(404).json({ error: "Not found" });
    report.params.parse(data.params);
    const created = await prisma.savedReport.create({ data: { ...data, ownerId: req.user.id } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

async function ownView(req, res) {
  const view = await prisma.savedReport.findUnique({ where: { id: req.params.id } });
  if (!view) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (view.ownerId !== req.user.id && req.user.role !== "admin") {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return view;
}

router.delete("/views/:id", async (req, res, next) => {
  try {
    if (!(await ownView(req, res))) return;
    await prisma.savedReport.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/views/:id/schedule -- admin only: it sends email.
// Recipients are existing active users, never free-form addresses.
router.post("/views/:id/schedule", requireRole("admin"), async (req, res, next) => {
  try {
    const view = await ownView(req, res);
    if (!view) return;
    const data = scheduleSchema.parse(req.body);
    const users = await prisma.user.findMany({
      where: { id: { in: data.recipientIds }, active: true, role: { in: ["admin", "editor", "viewer"] } },
      select: { id: true },
    });
    if (users.length !== new Set(data.recipientIds).size) {
      return res.status(400).json({ error: "Every recipient must be an active user." });
    }
    const created = await prisma.reportSchedule.create({ data: { ...data, savedReportId: view.id } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.delete("/schedules/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.reportSchedule.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    await prisma.reportSchedule.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id?...params[&format=csv] -- one query, two serializers,
// so the file always matches what the table showed.
router.get("/:id", async (req, res, next) => {
  try {
    const access = await accessFor(req);
    const report = getReport(req.params.id, access);
    if (!report) return res.status(404).json({ error: "Not found" });
    const today = resolveToday(req.query.today);
    // A ZodError here becomes a 400 via the central error middleware.
    const result = await runReport(report, req.query, {
      prisma,
      today,
    });
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${csvFilename(report.label, { now: today })}"`
      );
      res.setHeader("Cache-Control", "no-store");
      return res.send(toCsv(result.rows, result.columns));
    }
    res.set("Cache-Control", "no-store");
    return res.json({ id: report.id, label: report.label, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
