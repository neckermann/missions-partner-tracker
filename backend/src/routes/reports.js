const express = require("express");
const prisma = require("../prismaClient");
const { requireAuth } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { getReport, listReports } = require("../reports");
const { toCsv, csvFilename } = require("../utils/csv");

const router = express.Router();

// Reads, so no role gate. Any account that can sign in already reads every
// partner's full record -- see ADMIN_GUIDE.md § Who can see what. Roles
// govern writes, and a report writes nothing. Gating this to admins would
// be the first read in the app gated by role, and would contradict a
// decision made deliberately rather than by omission.
router.use(requireAuth);
router.use(requireFeature("reports"));

// GET /api/reports -- the picker: what reports exist, their filter fields
// and their columns. No data.
router.get("/", (req, res) => {
  res.json(listReports());
});

// GET /api/reports/:id?...params[&format=csv]
//
// One query, two serializers. The CSV is the same rows the table shows,
// through the same report's own `columns`, so the file cannot drift from
// what was on screen when someone hit Download.
router.get("/:id", async (req, res, next) => {
  try {
    const report = getReport(req.params.id);
    // Matches requireFeature's reasoning: something that isn't a report
    // should look like a URL that doesn't exist.
    if (!report) return res.status(404).json({ error: "Not found" });

    // Throws ZodError on bad input, which the central error middleware
    // turns into a 400 with a string `error` naming the field.
    const params = report.params.parse(req.query);
    const rows = await report.run(params, prisma);

    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${csvFilename(report.label)}"`);
      // Not cacheable: the same URL returns different rows as the data
      // changes, and this one ends up in a downloads folder.
      res.setHeader("Cache-Control", "no-store");
      return res.send(toCsv(rows, report.columns));
    }

    res.json({
      id: report.id,
      label: report.label,
      columns: report.columns,
      rows,
      // Echoed so the page can print "as of" and show what was asked for,
      // and so a saved PDF says what it was filtered by.
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
