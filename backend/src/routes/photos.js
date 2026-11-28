const express = require("express");
const prisma = require("../prismaClient");
const { VERIFIED_INLINE_TYPES } = require("../utils/fileResponse");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

// GET /api/photos/:id      the copy pages show: a JPEG at most 800px, or the full copy when it was small enough
// GET /api/photos/:id/raw  the full copy as uploaded (booklet, "open full size"); same access rules
//
// A photo is served to anyone only while its partner is shown on the public site (isPublic) and is not
// restricted. A photo of a partner who is not public, or who is restricted (the public site never carries
// a restricted partner's real photo, see maskData.js), needs a signed-in session: the address alone is no
// longer enough. Signed-in staff and guests still see it, since the admin screens load it with their cookie.
// The email digests link to photos too, and mail clients cannot sign in, so they only ever use a public
// partner's photo (emailDispatchShell.js partnerTileDetails) and fall back to a silhouette otherwise.
router.get("/:id", (req, res, next) => serve(req, res, next, false));
router.get("/:id/raw", (req, res, next) => serve(req, res, next, true));

async function serve(req, res, next, wantFull) {
  try {
    let photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
      select: {
        contentType: true,
        bytesRow: { select: wantFull ? { bytes: true } : { bytes: true, displayBytes: true } },
        partner: { select: { isPublic: true, isRestricted: true } },
      },
    });
    if (!photo?.bytesRow) return res.status(404).end();
    // The display copy is always a JPEG; without one the full copy is what is shown.
    if (!wantFull && photo.bytesRow.displayBytes) {
      photo = {
        contentType: "image/jpeg",
        bytesRow: { bytes: photo.bytesRow.displayBytes },
        partner: photo.partner,
      };
    }

    const openToAnyone = Boolean(photo.partner?.isPublic) && !photo.partner?.isRestricted;
    if (openToAnyone) return send(photo, res, true);
    // Signed in or refused (401); a refused caller learns nothing about whether this id exists.
    return requireAuth(req, res, (err) => (err ? next(err) : send(photo, res, false)));
  } catch (err) {
    next(err);
  }
}

function send(photo, res, isPublic) {
  // helmet()'s global Cross-Origin-Resource-Policy: same-origin would stop webmail clients
  // (Outlook on the web) from embedding this image in digest emails. The header only gates
  // third-party embedding, not who can fetch, so relaxing it here does not change access (#246).
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  // A photo row is never updated in place, so its bytes are immutable for this id: safe to cache. A
  // non-public photo is cached only by the signed-in person's own browser, never by a shared cache.
  // A photo that is not public is only ever cached by the signed-in person's own browser ("private"), and it is just as
  // immutable, so it is kept for the year too (it used to be re-downloaded every hour, full size).
  res.set(
    "Cache-Control",
    isPublic ? "public, max-age=31536000, immutable" : "private, max-age=31536000, immutable"
  );
  // Same VERIFIED_INLINE_TYPES allowlist partner files use (utils/fileResponse.js) rather than
  // trusting the stored contentType; defense-in-depth against a future upload-path bug.
  const contentType = VERIFIED_INLINE_TYPES.has(photo.contentType)
    ? photo.contentType
    : "application/octet-stream";
  res.set("Content-Type", contentType);
  res.send(photo.bytesRow.bytes);
}

module.exports = router;
