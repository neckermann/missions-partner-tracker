const express = require("express");
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { renderSubscriberPage, escapeHtml } = require("../utils/subscriberPage");

const router = express.Router();

// GET /api/public/unsubscribe?token= -- a sibling of publicSubscribe.js,
// not nested under it, since this needs to stay reachable from an old
// email even independent of how subscribe is mounted. Public, no login.
// Gated on publicPrayerDigest only (same as confirm) -- an existing
// subscriber should always be able to unsubscribe, regardless of
// publicDirectory/outboundEmail's current state.
router.use(requireFeature(["publicPrayerDigest"]));

function verifySubscriberUnsubscribeToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ""), process.env.SESSION_SECRET);
  } catch {
    return null;
  }
  return decoded?.subscriberUnsubscribe && decoded.id ? decoded : null;
}

// #327 Finding 6: this used to unsubscribe the moment the link was
// *fetched* -- a mail security scanner that pre-fetches every link in an
// inbox would silently unsubscribe someone who never clicked anything
// themselves. GET now only verifies the token and renders a page with a
// real confirm button (a plain <form method="POST">, still works with no
// JavaScript); POST is what actually deletes the subscriber.
// List-Unsubscribe-Post support (RFC 8058) lets a mail client's own
// native "Unsubscribe" button call the POST route directly -- see
// publicSubscribeEmails.js's List-Unsubscribe header for where that's
// wired up.
router.get("/", async (req, res) => {
  const decoded = verifySubscriberUnsubscribeToken(req.query.token);
  if (!decoded) return res.status(400).send(await renderSubscriberPage("This unsubscribe link isn't valid."));
  const token = escapeHtml(String(req.query.token));
  res.send(
    await renderSubscriberPage(
      (highlightColor) =>
        `Click below to unsubscribe from prayer updates.<br><br><form method="POST" action="/api/public/unsubscribe"><input type="hidden" name="token" value="${token}"><button type="submit" style="background:${highlightColor};color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:15px;cursor:pointer;">Confirm unsubscribe</button></form>`
    )
  );
});

// token in req.body (the confirm-button form above) or req.query (RFC
// 8058 one-click -- see routes/auth.js's own unsubscribe POST for the
// full reasoning, identical here).
router.post("/", express.urlencoded({ extended: false }), async (req, res) => {
  const decoded = verifySubscriberUnsubscribeToken(req.body?.token || req.query?.token);
  if (!decoded) return res.status(400).send(await renderSubscriberPage("This unsubscribe link isn't valid."));
  // Deletes the row outright, not a flag -- no lingering address once
  // someone's explicitly opted out. Cascades PublicSubscriberPartner.
  // deleteMany (not delete) so a stale/already-removed id degrades
  // gracefully rather than throwing.
  await prisma.publicSubscriber.deleteMany({ where: { id: decoded.id } });
  res.send(await renderSubscriberPage("You've been unsubscribed from prayer updates."));
});

module.exports = router;
