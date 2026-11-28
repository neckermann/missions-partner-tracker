const express = require("express");
const jwt = require("jsonwebtoken");
const prisma = require("../prismaClient");
const { renderSubscriberPage, escapeHtml, UNSUBSCRIBED_LINE } = require("../utils/subscriberPage");

const router = express.Router();

// GET /api/public/unsubscribe?token= -- a sibling of publicSubscribe.js so it stays reachable from
// an old email however subscribe is mounted. Public, no login. Deliberately behind no feature switch:
// the link in an email already sent has to keep working, and keep showing a page, after the church
// turns the public prayer digest or the public directory off. Do not add requireFeature here.

function verifySubscriberUnsubscribeToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ""), process.env.SESSION_SECRET);
  } catch {
    return null;
  }
  return decoded?.subscriberUnsubscribe && decoded.id ? decoded : null;
}

// #327 Finding 6: GET only verifies the token and renders a confirm button (a plain
// <form method="POST">, works without JavaScript); POST deletes the subscriber. Acting on fetch would
// let a mail scanner that prefetches links unsubscribe people who never clicked.
// List-Unsubscribe-Post (RFC 8058) lets a mail client's native button call POST directly (see
// publicSubscribeEmails.js).
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

// token in req.body (the confirm form) or req.query (RFC 8058 one-click); see routes/auth.js's
// unsubscribe POST.
router.post("/", express.urlencoded({ extended: false }), async (req, res) => {
  const decoded = verifySubscriberUnsubscribeToken(req.body?.token || req.query?.token);
  if (!decoded) return res.status(400).send(await renderSubscriberPage("This unsubscribe link isn't valid."));
  // Deletes the row outright, not a flag: no lingering address after an explicit opt-out. Cascades
  // PublicSubscriberPartner. deleteMany so a stale id degrades gracefully instead of throwing.
  await prisma.publicSubscriber.deleteMany({ where: { id: decoded.id } });
  res.send(await renderSubscriberPage("You've been unsubscribed from prayer updates.", UNSUBSCRIBED_LINE));
});

module.exports = router;
