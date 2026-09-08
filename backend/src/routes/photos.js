const express = require("express");
const prisma = require("../prismaClient");

const router = express.Router();

// GET /api/photos/:id/raw — public, unauthenticated. A missionary/org
// photo is reachable by anyone who has its URL, restricted or not —
// maskData.js is what keeps a restricted record's real photo out of any
// response in the first place, this route was never meant to be the
// access boundary.
router.get("/:id/raw", async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
      select: { bytes: true, contentType: true },
    });
    if (!photo) return res.status(404).end();

    // A photo row is never updated in place (a new upload creates a new
    // row — see the Photo model comment), so its bytes are immutable for
    // the life of this id. Safe to cache aggressively.
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("Content-Type", photo.contentType || "application/octet-stream");
    res.send(photo.bytes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
