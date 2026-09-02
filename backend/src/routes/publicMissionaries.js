const express = require("express");
const prisma = require("../prismaClient");
const { toPublicMissionary } = require("../utils/maskData");

const router = express.Router();

// GET /api/public/missionaries
// Returns the curated/masked list for the public website (map + list view)
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.missionary.findMany({
      where: { isPublic: true, archived: false },
      include: {
        adults: true,
        children: true,
        sendingChurch: true,
        sendingOrg: true,
        addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
        // Only the current photo (most recently received) is ever surfaced
        // publicly — never the upload history.
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1 },
      },
      orderBy: { displayName: "asc" },
    });

    const publicList = records.map(toPublicMissionary).filter(Boolean);
    res.json(publicList);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/missionaries/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.missionary.findUnique({
      where: { id: req.params.id },
      include: {
        adults: true,
        children: true,
        sendingChurch: true,
        sendingOrg: true,
        addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
        // Only the current photo (most recently received) is ever surfaced
        // publicly — never the upload history.
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1 },
      },
    });

    const publicRecord = toPublicMissionary(record);
    if (!publicRecord) return res.status(404).json({ error: "Not found" });
    res.json(publicRecord);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
