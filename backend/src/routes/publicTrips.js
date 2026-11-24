// Public, unauthenticated discovery surface for Trips (#252): the plain
// listing and the two id/token-addressed single-trip views an applicant
// sees before applying. Application submission (publicTripApplications.js)
// and participant self-service (publicTripParticipants.js) split out of
// this same file (#271 Finding) -- all three mount at the same
// /api/public/trips (or /api/public/trip-participants) prefix from
// server.js.
//
// Restricted-partner handling is NOT uniform across these three routes --
// see each route's own comment. The discovery list and GET /:id EXCLUDE a
// restricted-partner trip outright (404, same as not found at all); the
// token-addressed GET /by-token/:token MASKS it instead (toInitials-style
// generic label, not the real partner) since reaching it already requires
// a secret only staff chose to share.
const express = require("express");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { getSettings, partnerFieldLabel, tripPartnerSelect } = require("../utils/publicTripShared");

const router = express.Router();

// `template` is the church-wide ChurchSettings.tripApplicationTemplate --
// rendered first, with this trip's own applicationQuestions layered after.
// One combined, ordered list on the actual form; TripApplication.responses
// stays keyed by question id regardless of which layer it came from, so
// nothing downstream needs to know the difference.
function shapeTripForApplicant(trip, settings) {
  return {
    id: trip.id,
    name: trip.name,
    type: trip.type,
    description: trip.description,
    startDate: trip.startDate,
    endDate: trip.endDate,
    fieldDisplayName: partnerFieldLabel(trip.partner, settings),
    isRestricted: !!trip.partner?.isRestricted,
    applicationQuestions: [
      ...(settings?.tripApplicationTemplate || []),
      ...(trip.applicationQuestions || []),
    ],
    // Tells the public form whether to render the structured mailing-
    // address block at all -- see ChurchSettings.collectApplicantAddress's
    // own schema comment.
    collectApplicantAddress: settings?.collectApplicantAddress !== false,
    // Same, for the structured emergency-contact block -- see
    // ChurchSettings.collectEmergencyContact's own schema comment.
    collectEmergencyContact: settings?.collectEmergencyContact !== false,
    // Date of birth is always collected/required now -- no settings flag
    // needed here; the wizard shows that step unconditionally and decides
    // whether to show the parent/guardian step itself, client-side, via
    // the shared isMinorForTrip(dateOfBirth, startDate) check (also
    // enforced server-side on submission -- see publicTripApplications.js).
  };
}

// GET /api/public/trips -- discovery listing. Gated by trips AND
// publicTripDiscovery (both required -- see requireFeature's any-of
// semantics for an array, which is why these are two separate calls,
// not one array call).
router.get("/", requireFeature("trips"), requireFeature("publicTripDiscovery"), async (req, res, next) => {
  try {
    const [trips, settings] = await Promise.all([
      prisma.trip.findMany({
        where: {
          isPublic: true,
          AND: [
            { OR: [{ status: "accepting_applications" }, { status: "planning" }] },
            { OR: [{ partnerId: null }, { partner: { is: { isRestricted: false } } }] },
          ],
        },
        select: {
          id: true,
          name: true,
          type: true,
          description: true,
          startDate: true,
          endDate: true,
          status: true,
          ...tripPartnerSelect,
        },
        orderBy: { startDate: "asc" },
      }),
      getSettings(),
    ]);
    // Belt-and-suspenders: a Trip with no partnerId has no `partner` row
    // to filter on above (the `where` only excludes a *restricted*
    // linked partner -- a null partnerId already passes that clause).
    // onlineGivingUrl is church-wide, not per-trip, but repeated on
    // every card here -- a trip-level "Donate" button next to Apply,
    // same ManagedMissions-inferred pattern (competitor backlog item),
    // reusing the giving link §13 already built rather than adding a
    // second one scoped to discovery specifically.
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
        onlineGivingUrl: settings?.onlineGivingUrl || null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

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
    res.json(shapeTripForApplicant(trip, settings));
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
    res.json(shapeTripForApplicant(trip, settings));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
