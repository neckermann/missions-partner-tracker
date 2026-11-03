const express = require("express");
const prisma = require("../prismaClient");
const { VERIFIED_INLINE_TYPES } = require("../utils/fileResponse");

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
    // Same VERIFIED_INLINE_TYPES allowlist newsletters/documents use (see
    // utils/fileResponse.js) rather than trusting the stored contentType
    // directly. Photo uploads are signature-verified to image/jpeg,
    // image/png, or image/webp at the multer layer in partners.js (all
    // three are in VERIFIED_INLINE_TYPES too), so this is defense-in-depth
    // against a future upload-path bug rather than a live gap -- but it's
    // the one other place a stored contentType reaches a response header,
    // and it shouldn't be a second, divergent copy of a rule the codebase
    // already centralized once.
    const contentType = VERIFIED_INLINE_TYPES.has(photo.contentType)
      ? photo.contentType
      : "application/octet-stream";
    res.set("Content-Type", contentType);
    res.send(photo.bytes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
