const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const prisma = require("../prismaClient");
const jwt = require("jsonwebtoken");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { renderSubscriberPage } = require("../utils/subscriberPage");
const { sendConfirmEmail, sendConfirmChangeEmail } = require("../utils/publicSubscribeEmails");

const router = express.Router();

const CADENCES = ["biweekly", "monthly", "quarterly"];

// Public and anonymous subscription (#202): the visibility gate is the feature flag, not auth.
// publicDirectory/outboundEmail are additionally required for POST / only (see
// requireSubscribeDependencies).
router.use(requireFeature(["publicPrayerDigest"]));

// Only POST / needs publicDirectory and outboundEmail: no public site to follow partners from
// without the first, no way to send a confirmation without the second. GET /confirm deliberately
// requires neither, so an existing subscriber can confirm a link already in their inbox even if
// the church later turns public browsing or email off; publicPrayerDigest alone gates it.
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

// Scoped to this POST only, not GET /confirm: a tighter ceiling on top of the /api/public limiter
// in server.js (120/min), for the one route with a real external side effect (an email). Relaxed
// under test like the login limiter in server.js.
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

// Same preference order and tier-field mapping as settingsDispatches.js's PUT uses to migrate a
// subscriber off a descoped tier (#209), applied to the new-subscriber default: a caller that omits
// cadence must not land on a tier the admin has turned off (biweekly is disabled by default).
const CADENCE_FALLBACK_PREFERENCE = ["monthly", "quarterly", "biweekly"];
const CADENCE_TIER_FIELDS = {
  biweekly: "cadenceBiweeklyEnabled",
  monthly: "cadenceMonthlyEnabled",
  quarterly: "cadenceQuarterlyEnabled",
};

async function defaultCadenceTier() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { cadenceBiweeklyEnabled: true, cadenceMonthlyEnabled: true, cadenceQuarterlyEnabled: true },
  });
  const state = settings || {
    cadenceBiweeklyEnabled: false,
    cadenceMonthlyEnabled: true,
    cadenceQuarterlyEnabled: true,
  };
  return CADENCE_FALLBACK_PREFERENCE.find((tier) => state[CADENCE_TIER_FIELDS[tier]]) || "monthly";
}

// Shared by all three outcomes below (new/still-unconfirmed/confirmed)
// so a caller can never tell them apart from the response.
async function applySubscription(existing, email, data, fallbackCadence) {
  if (existing) await prisma.publicSubscriberPartner.deleteMany({ where: { subscriberId: existing.id } });
  const writeData = {
    cadence: data.cadence || existing?.cadence || fallbackCadence,
    allPartners: data.allPartners ?? existing?.allPartners ?? true,
    scopedPartners: data.partnerIds.length
      ? { create: data.partnerIds.map((partnerId) => ({ partnerId })) }
      : undefined,
  };
  if (!existing) return prisma.publicSubscriber.create({ data: { email, ...writeData } });
  return prisma.publicSubscriber.update({ where: { id: existing.id }, data: writeData });
}

// POST / -- subscribe (or re-scope an existing subscription). Always responds with the same
// generic message whatever the outcome (new, still-unconfirmed, already-confirmed): the
// no-enumeration discipline of routes/auth.js's login. An already-confirmed row is NOT sent a
// fresh confirmation email, which would reveal "this address is already subscribed" via the inbox.
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

    // #327 Finding 11: nothing proves the caller owns an already-confirmed subscriber's address, so
    // nothing is written for that case: the proposed change travels in a confirm-change link
    // (buildSubscriberConfirmChangeToken) and is applied only when it is clicked. A new or
    // still-unconfirmed row is not live yet, so applying the latest draft immediately is harmless.
    if (existing?.confirmedAt) {
      await sendConfirmChangeEmail(existing, {
        cadence: parsed.data.cadence,
        allPartners: parsed.data.allPartners,
        partnerIds,
      }).catch((err) => console.error("Confirm-change email failed:", err));
      return res.json({ message: "Check your email to confirm your subscription." });
    }

    const subscriber = await applySubscription(
      existing,
      email,
      {
        cadence: parsed.data.cadence,
        allPartners: parsed.data.allPartners,
        partnerIds,
      },
      await defaultCadenceTier()
    );

    await sendConfirmEmail(subscriber).catch((err) => console.error("Confirm email failed:", err));

    res.json({ message: "Check your email to confirm your subscription." });
  } catch (err) {
    next(err);
  }
});

// GET /confirm?token= -- public, reached from the confirmation email. No requireOutboundEmail:
// confirming sends nothing.
router.get("/confirm", async (req, res) => {
  let decoded;
  try {
    decoded = jwt.verify(String(req.query.token || ""), process.env.SESSION_SECRET);
  } catch {
    return res.status(400).send(await renderSubscriberPage("This confirmation link isn't valid."));
  }
  if (!decoded?.id || (!decoded.subscriberConfirm && !decoded.subscriberConfirmChange)) {
    return res.status(400).send(await renderSubscriberPage("This confirmation link isn't valid."));
  }

  // #327 Finding 11: a confirm-change link carries the proposed values and is where they are
  // applied (POST / never writes them elsewhere). Degrades gracefully (0 rows, still 200) if the
  // subscriber was deleted or unsubscribed since the link was sent.
  if (decoded.subscriberConfirmChange) {
    const existing = await prisma.publicSubscriber.findUnique({ where: { id: decoded.id } });
    if (existing) {
      await applySubscription(
        existing,
        existing.email,
        { cadence: decoded.cadence, allPartners: decoded.allPartners, partnerIds: decoded.partnerIds || [] },
        await defaultCadenceTier()
      );
    }
    return res.send(await renderSubscriberPage("Your subscription has been updated."));
  }

  await prisma.publicSubscriber.updateMany({
    where: { id: decoded.id, confirmedAt: null },
    data: { confirmedAt: new Date() },
  });
  res.send(await renderSubscriberPage("You're subscribed! You'll start receiving prayer updates soon."));
});

module.exports = router;
