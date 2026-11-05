const express = require("express");
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { renderSubscriberPage } = require("../utils/subscriberPage");

const router = express.Router();

// GET /api/public/unsubscribe?token= -- a sibling of publicSubscribe.js,
// not nested under it, since this needs to stay reachable from an old
// email even independent of how subscribe is mounted. Public, no login.
// Gated on publicPrayerDigest only (same as confirm) -- an existing
// subscriber should always be able to unsubscribe, regardless of
// publicDirectory/outboundEmail's current state.
router.use(requireFeature(["publicPrayerDigest"]));

router.get("/", async (req, res) => {
  let decoded;
  try {
    decoded = jwt.verify(String(req.query.token || ""), process.env.SESSION_SECRET);
  } catch {
    return res.status(400).send(await renderSubscriberPage("This unsubscribe link isn't valid."));
  }
  if (!decoded?.subscriberUnsubscribe || !decoded.id) {
    return res.status(400).send(await renderSubscriberPage("This unsubscribe link isn't valid."));
  }
  // Deletes the row outright, not a flag -- no lingering address once
  // someone's explicitly opted out. Cascades PublicSubscriberPartner.
  // deleteMany (not delete) so a stale/already-removed id degrades
  // gracefully rather than throwing.
  await prisma.publicSubscriber.deleteMany({ where: { id: decoded.id } });
  res.send(await renderSubscriberPage("You've been unsubscribed from prayer updates."));
});

module.exports = router;
