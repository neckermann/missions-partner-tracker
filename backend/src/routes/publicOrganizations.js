const express = require("express");
const prisma = require("../prismaClient");
const { toPublicOrganization } = require("../utils/maskData");

const router = express.Router();

// GET /api/public/organizations
router.get("/", async (req, res, next) => {
  try {
    const records = await prisma.organization.findMany({
      where: { isPublic: true, archived: false },
      include: {
        addresses: { where: { type: "physical" } }, // only the pin coordinates are ever surfaced publicly
        // Only the current photo (most recently received) is ever surfaced
        // publicly — never the upload history.
        photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1 },
      },
      orderBy: { name: "asc" },
    });

    const publicList = records.map(toPublicOrganization).filter(Boolean);
    res.json(publicList);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/organizations/:id
router.get("/:id", async (req, res, next) => {
  try {
    const record = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        addresses: { where: { type: "physical" } },
      },
    });

    const publicRecord = toPublicOrganization(record);
    if (!publicRecord) return res.status(404).json({ error: "Not found" });
    res.json(publicRecord);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
