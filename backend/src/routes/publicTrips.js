// Public, unauthenticated surfaces for Trips (#252): discovery listing,
// application submission (plain id-addressed + applicationShareToken-
// addressed), a participant's public support-raising page (shareToken) and
// self-service page (signed access token), and lost-link recovery.
//
// Restricted-partner handling is NOT uniform across these routes -- see
// each route's own comment. The discovery list and the plain
// id-addressed application route EXCLUDE a restricted-partner trip
// outright (404, same as not found at all); the token-addressed
// application route and the shareToken support-raising route MASK it
// instead (toInitials-style generic label, not the real partner) since
// reaching either already requires a secret only staff chose to share.
// The signed-access-token self-service route is never blocked or masked
// at all -- the person reading it is the one actually going.
const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { toInitials } = require("../utils/maskData");
const {
  buildTripParticipantAccessToken,
  verifyTripParticipantAccessToken,
  sendTripParticipantAccessLinks,
} = require("../utils/tripAccessToken");

const router = express.Router();

async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      onlineGivingUrl: true,
      onlineGivingInstructions: true,
      collectDonorContactInfo: true,
      allowPublicSupportRaisingLinks: true,
      allowPrivateApplicationLinks: true,
    },
  });
}

// A restricted partner's label, masked the same conceptual way
// toPublicPartner() masks one -- not that function directly, since it
// requires partner.isPublic to be true (many trip partners aren't in
// the public directory at all), which would make it return null for
// most restricted trip partners rather than a masked label.
function partnerFieldLabel(partner) {
  if (!partner) return null;
  if (partner.isRestricted) return toInitials(partner.displayName);
  return partner.fieldDisplayName || partner.displayName;
}

function shapeTripForApplicant(trip) {
  return {
    id: trip.id,
    name: trip.name,
    type: trip.type,
    description: trip.description,
    startDate: trip.startDate,
    endDate: trip.endDate,
    fieldDisplayName: partnerFieldLabel(trip.partner),
    isRestricted: !!trip.partner?.isRestricted,
    applicationQuestions: trip.applicationQuestions || [],
  };
}

const tripPartnerSelect = {
  partner: { select: { displayName: true, fieldDisplayName: true, isRestricted: true } },
};

// GET /api/public/trips -- discovery listing. Gated by trips AND
// publicTripDiscovery (both required -- see requireFeature's any-of
// semantics for an array, which is why these are two separate calls,
// not one array call).
router.get(
  "/",
  requireFeature("trips"),
  requireFeature("publicTripDiscovery"),
  async (req, res, next) => {
    try {
      const trips = await prisma.trip.findMany({
        where: {
          isPublic: true,
          AND: [
            { OR: [{ status: "accepting_applications" }, { status: "planning" }] },
            { OR: [{ partnerId: null }, { partner: { is: { isRestricted: false } } }] },
          ],
        },
        select: { id: true, name: true, type: true, description: true, startDate: true, endDate: true, status: true, ...tripPartnerSelect },
        orderBy: { startDate: "asc" },
      });
      // Belt-and-suspenders: a Trip with no partnerId has no `partner` row
      // to filter on above (the `where` only excludes a *restricted*
      // linked partner -- a null partnerId already passes that clause).
      res.json(
        trips.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          description: t.description,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.status,
          fieldDisplayName: t.partner?.fieldDisplayName || t.partner?.displayName || null,
        }))
      );
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/public/trips/:id -- plain id-addressed. Requires
// publicTripDiscovery AND isPublic AND accepting_applications AND not
// restricted -- 404 otherwise, same not-found state as an unknown id.
router.get("/:id", requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    const publiclyDiscoverable = isFeatureEnabled(settings?.enabledFeatures, "publicTripDiscovery");

    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        startDate: true,
        endDate: true,
        status: true,
        isPublic: true,
        applicationQuestions: true,
        ...tripPartnerSelect,
      },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });
    if (trip.partner?.isRestricted) return res.status(404).json({ error: "Not found" });
    if (!publiclyDiscoverable || !trip.isPublic || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    res.json(shapeTripForApplicant(trip));
  } catch (err) {
    next(err);
  }
});

// GET /api/public/trips/by-token/:token -- the private application link.
// Works regardless of isPublic/publicTripDiscovery; for a restricted
// partner, returns a MASKED trip rather than 404ing.
router.get("/by-token/:token", requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.allowPrivateApplicationLinks) return res.status(404).json({ error: "Not found" });

    const trip = await prisma.trip.findUnique({
      where: { applicationShareToken: req.params.token },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        startDate: true,
        endDate: true,
        status: true,
        applicationQuestions: true,
        ...tripPartnerSelect,
      },
    });
    if (!trip || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    res.json(shapeTripForApplicant(trip));
  } catch (err) {
    next(err);
  }
});

const applicationSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  responses: z.record(z.string(), z.string()).optional(),
});

async function createApplication(trip, body, res) {
  const data = applicationSchema.parse(body);
  await prisma.tripApplication.create({
    data: {
      tripId: trip.id,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      responses: data.responses || {},
    },
  });
  res.status(201).json({ submitted: true });
}

// POST /api/public/trips/:id/apply -- plain id-addressed submission.
router.post("/:id/apply", requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    const publiclyDiscoverable = isFeatureEnabled(settings?.enabledFeatures, "publicTripDiscovery");

    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, isPublic: true, partner: { select: { isRestricted: true } } },
    });
    if (!trip || trip.partner?.isRestricted) return res.status(404).json({ error: "Not found" });
    if (!publiclyDiscoverable || !trip.isPublic || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    await createApplication(trip, req.body, res);
  } catch (err) {
    next(err);
  }
});

// POST /api/public/trips/by-token/:token/apply -- private-link submission.
// Works for a restricted partner (masked view already shown on the GET
// above); still 404s on a bad token or wrong status.
router.post("/by-token/:token/apply", requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.allowPrivateApplicationLinks) return res.status(404).json({ error: "Not found" });

    const trip = await prisma.trip.findUnique({
      where: { applicationShareToken: req.params.token },
      select: { id: true, status: true },
    });
    if (!trip || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    await createApplication(trip, req.body, res);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/trip-participants/by-token/:shareToken -- the public
// support-raising page. 404s when allowPublicSupportRaisingLinks is off or the
// token doesn't match anything. Restricted partner: masked, not 404.
router.get(
  "/participants/by-token/:shareToken",
  requireFeature("trips"),
  async (req, res, next) => {
    try {
      const settings = await getSettings();
      if (!settings?.allowPublicSupportRaisingLinks) return res.status(404).json({ error: "Not found" });

      const participant = await prisma.tripParticipant.findUnique({
        where: { shareToken: req.params.shareToken },
        include: {
          trip: { select: { name: true, type: true, startDate: true, endDate: true, ...tripPartnerSelect } },
          contributions: { select: { amount: true } },
        },
      });
      if (!participant) return res.status(404).json({ error: "Not found" });
      if (participant.trip.partner?.isRestricted) {
        // still render -- masked -- rather than 404ing.
      }

      const raised = participant.contributions.reduce((sum, c) => sum + c.amount, 0);

      res.json({
        firstName: participant.firstName,
        lastName: participant.lastName,
        story: participant.story,
        supportRaisingGoal: participant.supportRaisingGoal,
        raised,
        trip: {
          name: participant.trip.name,
          type: participant.trip.type,
          startDate: participant.trip.startDate,
          endDate: participant.trip.endDate,
          fieldDisplayName: partnerFieldLabel(participant.trip.partner),
        },
        // Never flightDetails, never donor contact info -- public mode only.
        giving: {
          onlineGivingUrl: settings.onlineGivingUrl || null,
          onlineGivingInstructions: settings.onlineGivingInstructions || null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/public/trip-participants/access?token=... -- the self-service
// page. Never blocked by anything above -- the one surface with neither
// masking nor exclusion at all.
router.get("/participants/access", requireFeature("trips"), async (req, res, next) => {
  try {
    const payload = verifyTripParticipantAccessToken(String(req.query.token || ""));
    if (!payload) return res.status(401).json({ error: "Invalid or expired link" });

    const participant = await prisma.tripParticipant.findUnique({
      where: { id: payload.id },
      include: {
        trip: {
          select: {
            name: true,
            type: true,
            description: true,
            startDate: true,
            endDate: true,
            flightDetails: true,
            meetings: true,
            documents: { where: { OR: [{ participantId: payload.id }, { participantId: null }] } },
            documentRequirements: true,
            partner: { select: { displayName: true, fieldDisplayName: true } },
          },
        },
        contributions: true,
      },
    });
    if (!participant || participant.accessTokenVersion !== payload.v) {
      return res.status(401).json({ error: "Invalid or expired link" });
    }

    const settings = await getSettings();
    const raised = participant.contributions.reduce((sum, c) => sum + c.amount, 0);
    const missingRequirements = participant.trip.documentRequirements.filter(
      (req) => !participant.trip.documents.some((d) => d.requirementId === req.id && d.participantId === participant.id)
    );

    res.json({
      firstName: participant.firstName,
      lastName: participant.lastName,
      story: participant.story,
      supportRaisingGoal: participant.supportRaisingGoal,
      raised,
      contributions: settings?.collectDonorContactInfo
        ? participant.contributions
        : participant.contributions.map(({ donorEmail, donorPhone, ...c }) => c),
      trip: {
        name: participant.trip.name,
        type: participant.trip.type,
        description: participant.trip.description,
        startDate: participant.trip.startDate,
        endDate: participant.trip.endDate,
        flightDetails: participant.trip.flightDetails,
        fieldDisplayName: participant.trip.partner?.fieldDisplayName || participant.trip.partner?.displayName || null,
      },
      meetings: participant.trip.meetings,
      missingDocumentRequirements: missingRequirements.map((r) => r.label),
      giving: {
        onlineGivingUrl: settings?.onlineGivingUrl || null,
        onlineGivingInstructions: settings?.onlineGivingInstructions || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Same rate-limiter shape as publicSubscribe.js's subscribeLimiter --
// without it this route is a free way to email-bomb any address.
const accessRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 10,
});

const recoverySchema = z.object({ email: z.string().email() });

// POST /api/public/trip-participants/request-access-link -- §4a. Always
// the same response regardless of whether anything matched (enumeration
// prevention, same precedent as publicSubscribe.js's applySubscription).
router.post(
  "/participants/request-access-link",
  requireFeature("trips"),
  requireFeature("outboundEmail"),
  accessRecoveryLimiter,
  async (req, res, next) => {
    try {
      const { email } = recoverySchema.parse(req.body);
      await sendTripParticipantAccessLinks(email);
      res.json({ message: "If that email has a trip participant record, we've sent a new link." });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
