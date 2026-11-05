const express = require("express");
const { silhouetteMarkup } = require("../utils/silhouette");

const router = express.Router();

// GET /api/silhouette/:category.svg — public, unauthenticated, same
// reasoning as photos.js's /raw route: this needs to work with no
// session cookie at all, since an email client fetches it directly.
// utils/silhouette.js's own `silhouetteFor()` returns a data: URI, fine
// for the public site's own <img> tags (browsers render those inline
// with no extra request) but most email clients (Outlook chief among
// them) strip or refuse to render a data: URI in an <img src> for
// security reasons -- so the email digest (see
// utils/emailDigest.js's partnerTileDetails) needs an actual reachable
// URL instead, which is what this route exists to provide. Deterministic
// per category/color, so safe to cache aggressively like a real photo.
router.get("/:category.svg", (req, res) => {
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("Content-Type", "image/svg+xml");
  res.send(silhouetteMarkup(req.params.category));
});

module.exports = router;
