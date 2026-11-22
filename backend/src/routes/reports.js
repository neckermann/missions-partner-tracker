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
  return { role: req.user.role, isEnabled: (key) => isFeatureEnabled(settings?.enabledFeatures, key) };
}

// GET /api/reports -- the hub catalog (groups + report metadata, no data).
router.get("/", async (req, res, next) => {
  try {
    res.json(listReports(await accessFor(req)));
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id?...params[&format=csv] -- one query, two serializers,
// so the file always matches what the table showed.
router.get("/:id", async (req, res, next) => {
  try {
    const report = getReport(req.params.id, await accessFor(req));
    if (!report) return res.status(404).json({ error: "Not found" });
    const today = resolveToday(req.query.today);
    // A ZodError here becomes a 400 via the central error middleware.
    const result = await runReport(report, req.query, { prisma, today });
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
