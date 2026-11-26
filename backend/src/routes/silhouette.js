const express = require("express");
const { silhouetteMarkup } = require("../utils/silhouette");

const router = express.Router();

// GET /api/silhouette/:category.svg — public, unauthenticated, like photos.js /raw: email clients
// fetch it with no session. silhouetteFor() returns a data: URI, which most email clients (Outlook
// especially) refuse in <img src>, so email digests (emailDispatchShell.js partnerTileDetails) need
// a real URL. Deterministic per category/color, so safe to cache aggressively.
router.get("/:category.svg", (req, res) => {
  // Same as photos.js /:id/raw: helmet()'s same-origin CORP would block webmail embedding (#246).
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("Content-Type", "image/svg+xml");
  res.send(silhouetteMarkup(req.params.category));
});

module.exports = router;
