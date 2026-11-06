const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const prisma = require("../prismaClient");
const jwt = require("jsonwebtoken");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { sendEmail } = require("../utils/email");
const { buildSubscriberConfirmUrl } = require("../utils/digestShell");
const { renderSubscriberPage, escapeHtml, PRIVACY_LINE } = require("../utils/subscriberPage");

const router = express.Router();

const CADENCES = ["biweekly", "monthly", "quarterly"];

// Public and anonymous subscription (#202): no login required, so the
// visibility gate is purely the feature flag, not an auth check.
// publicDirectory/outboundEmail are each additionally required, but
// only for POST / specifically -- see requireSubscribeDependencies and
// GET /confirm's own comments below for why they don't apply uniformly
// to every route in this file.
router.use(requireFeature(["publicPrayerDigest"]));

// Only POST / (actually subscribing) needs publicDirectory and
// outboundEmail -- there's no public site to follow partners from
// without the first, and no way to send a confirmation email without
// the second. GET /confirm deliberately does NOT require either: it
// doesn't send anything or expose partner data, and an existing
// subscriber should be able to confirm a link already in their inbox
// even if the church later turns public browsing or email off --
// publicPrayerDigest alone is the gate for that route.
async function requireSubscribeDependencies(req, res, next) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const ok =
    isFeatureEnabled(settings?.enabledFeatures, "publicDirectory") &&
    isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");
  if (!ok) return res.status(404).json({ error: "Not found" });
  next();
}

// Scoped to just this one POST handler, not the whole /subscribe path
// (which GET /confirm also lives under) -- the broad /api/public prefix
// limiter in server.js (120/min) already covers every route in this
// file by path; this is a tighter ceiling on top of that, only for the
// one route with a real external side effect (an email sent). Relaxed
// under test, same reasoning/pattern as the login route's own limiter
// in server.js.
const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 10,
});

const subscribeSchema = z.object({
  email: z.string().email(),
  cadence: z.enum(CADENCES).optional(),
  allPartners: z.boolean().optional(),
  partnerIds: z.array(z.string()).optional(),
});

// Shared by all three outcomes below (new/still-unconfirmed/confirmed)
// so a caller can never tell them apart from the response.
async function applySubscription(existing, email, data) {
  if (existing) await prisma.publicSubscriberPartner.deleteMany({ where: { subscriberId: existing.id } });
  const writeData = {
    cadence: data.cadence || existing?.cadence || "biweekly",
    allPartners: data.allPartners ?? existing?.allPartners ?? true,
    scopedPartners: data.partnerIds.length
      ? { create: data.partnerIds.map((partnerId) => ({ partnerId })) }
      : undefined,
  };
  if (!existing) return prisma.publicSubscriber.create({ data: { email, ...writeData } });
  return prisma.publicSubscriber.update({ where: { id: existing.id }, data: writeData });
}

async function sendConfirmEmail(subscriber) {
  const confirmUrl = buildSubscriberConfirmUrl(subscriber.id);
  if (!confirmUrl) return; // APP_BASE_URL not set -- nothing clickable to send
  await sendEmail({
    to: subscriber.email,
    subject: "Confirm your prayer update subscription",
    text: `Click to confirm: ${confirmUrl}\n\n${PRIVACY_LINE}`,
    html: `<p>Click to confirm your subscription:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p style="color:#888;font-size:12px;">${escapeHtml(PRIVACY_LINE)}</p>`,
  });
}

// POST / -- subscribe (or re-scope an existing subscription). Always
// responds with the exact same generic message regardless of outcome
// (new email, still-unconfirmed email, already-confirmed email) -- same
// no-enumeration discipline routes/auth.js's login route already
// applies via its dummy-hash comparison. An already-confirmed row gets
// its scope updated but is NOT sent a fresh confirmation email -- doing
// so would let a caller learn "this address is already subscribed" from
// inbox content even though the HTTP response never says so.
router.post("/", subscribeLimiter, requireSubscribeDependencies, async (req, res, next) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "A valid email is required" });
    const email = parsed.data.email.trim().toLowerCase();

    let partnerIds = [];
    if (parsed.data.partnerIds?.length) {
      const validPartners = await prisma.partner.findMany({
        where: { id: { in: parsed.data.partnerIds }, isPublic: true, archived: false },
        select: { id: true },
      });
      partnerIds = validPartners.map((p) => p.id);
    }

    const existing = await prisma.publicSubscriber.findUnique({ where: { email } });
    const subscriber = await applySubscription(existing, email, {
      cadence: parsed.data.cadence,
      allPartners: parsed.data.allPartners,
      partnerIds,
    });

    if (!existing?.confirmedAt) {
      await sendConfirmEmail(subscriber).catch((err) => console.error("Confirm email failed:", err));
    }

    res.json({ message: "Check your email to confirm your subscription." });
  } catch (err) {
    next(err);
  }
});

// GET /confirm?token= -- public, reached straight from the confirmation
// email. No requireOutboundEmail here (see that function's own comment
// above) -- confirming doesn't itself send anything.
router.get("/confirm", async (req, res) => {
  let decoded;
  try {
    decoded = jwt.verify(String(req.query.token || ""), process.env.SESSION_SECRET);
  } catch {
    return res.status(400).send(await renderSubscriberPage("This confirmation link isn't valid."));
  }
  if (!decoded?.subscriberConfirm || !decoded.id) {
    return res.status(400).send(await renderSubscriberPage("This confirmation link isn't valid."));
  }
  await prisma.publicSubscriber.updateMany({
    where: { id: decoded.id, confirmedAt: null },
    data: { confirmedAt: new Date() },
  });
  res.send(await renderSubscriberPage("You're subscribed! You'll start receiving prayer updates soon."));
});

module.exports = router;
