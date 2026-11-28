const express = require("express");
const { z } = require("zod");
const { requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const {
  CADENCE_KEYS,
  DEFAULT_PER_PARTNER,
  MAX_PER_PARTNER,
  isValidDay,
  buildPrayerSheet,
} = require("../utils/prayerSheet");

const router = express.Router();
router.use(requireFeature("prayerRequests"));
// Staff only (a guest sees only what their own access reaches). The content is already limited to what the public
// site may show, so a viewer can read it too.
router.use(requireRole("admin", "editor", "viewer"));

const querySchema = z.object({
  cadence: z.enum(CADENCE_KEYS).default("weekly"),
  // The Sunday the sheet is for, yyyy-mm-dd.
  date: z.string().refine(isValidDay, "date must be a real day, yyyy-mm-dd"),
  perPartner: z.coerce.number().int().min(1).max(MAX_PER_PARTNER).default(DEFAULT_PER_PARTNER),
});

// GET /api/prayer-sheet?date=2026-12-06&cadence=weekly|biweekly|monthly&perPartner=3
// Which partners are on that sheet and the requests to print for each (utils/prayerSheet.js for the rules).
router.get("/", async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.json(await buildPrayerSheet(parsed.data));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
