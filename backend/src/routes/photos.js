const express = require("express");
const prisma = require("../prismaClient");
const { VERIFIED_INLINE_TYPES } = require("../utils/fileResponse");

const router = express.Router();

// GET /api/photos/:id/raw — public, unauthenticated. Anyone with the URL can fetch a photo,
// restricted or not: maskData.js keeps a restricted record's real photo out of responses, so
// this route is not the access boundary.
router.get("/:id/raw", async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
      select: { contentType: true, bytesRow: { select: { bytes: true } } },
    });
    if (!photo?.bytesRow) return res.status(404).end();

    // helmet()'s global Cross-Origin-Resource-Policy: same-origin would stop webmail clients
    // (Outlook on the web) from embedding this image in digest emails. The header only gates
    // third-party embedding, not who can fetch, so relaxing it here does not change access (#246).
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    // A photo row is never updated in place, so its bytes are immutable for this id: safe to cache.
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    // Same VERIFIED_INLINE_TYPES allowlist partner files use (utils/fileResponse.js) rather than
    // trusting the stored contentType; defense-in-depth against a future upload-path bug.
    const contentType = VERIFIED_INLINE_TYPES.has(photo.contentType)
      ? photo.contentType
      : "application/octet-stream";
    res.set("Content-Type", contentType);
    res.send(photo.bytesRow.bytes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
