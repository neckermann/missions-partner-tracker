// Public, unauthenticated discovery surface for Trips (#252): the listing and the two
// id/token-addressed single-trip views an applicant sees before applying. Mounted at
// /api/public/trips from server.js.
//
// Restricted-partner handling is NOT uniform: the discovery list and GET /:id EXCLUDE a
// restricted-partner trip (404, as if not found); GET /by-token/:token MASKS it instead, since
// reaching it requires a secret only staff chose to share.
const express = require("express");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const { isFeatureEnabled } = require("../utils/features");
const { getSettings, partnerFieldLabel, tripPartnerSelect } = require("../utils/publicTripShared");
const { loadApplicantQuestions } = require("../utils/tripTemplates");

// A link that is real but whose trip is not taking applications (yet, or any more). The caller
// has already shown the link is valid, so saying so reveals nothing. Still a 404 so nothing else changes.
function applicationsNotOpen(trip) {
  return {
    error: "Applications for this trip are not open.",
    code: "applications_closed",
    // A restricted partner's trip name can give away where they serve, so it is left out.
    tripName: trip.partner?.isRestricted ? null : trip.name,
    status: trip.status,
  };
}

const router = express.Router();

// `questions` is the church-wide application questions first, with this trip's own layered
// after (loadApplicantQuestions): one combined, ordered list on the actual form. An answer is
// keyed by question id whichever layer it came from, so nothing downstream needs to know.
function shapeTripForApplicant(trip, settings, questions) {
  return {
    id: trip.id,
    name: trip.name,
    type: trip.type,
    description: trip.description,
    startDate: trip.startDate,
    endDate: trip.endDate,
    fieldDisplayName: partnerFieldLabel(trip.partner, settings),
    isRestricted: !!trip.partner?.isRestricted,
    applicationQuestions: questions,
    // Whether the public form renders the structured mailing-address block (ChurchSettings.collectApplicantAddress).
    collectApplicantAddress: settings?.collectApplicantAddress !== false,
    // Same, for the emergency-contact block (ChurchSettings.collectEmergencyContact).
    collectEmergencyContact: settings?.collectEmergencyContact !== false,
    // Date of birth is always collected; the wizard decides client-side whether to show the
    // parent/guardian step via isMinorForTrip, which is also enforced on submission
    // (publicTripApplications.js).
  };
}

// GET /api/public/trips -- discovery listing. Gated by trips AND publicTripDiscovery, as two
// separate requireFeature calls since an array means any-of.
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
    // Belt-and-suspenders: a Trip with no partnerId has no `partner` row to filter on (the `where`
    // only excludes a *restricted* linked partner). onlineGivingUrl is church-wide but repeated on
    // every card for a trip-level "Donate" button.
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
        ...tripPartnerSelect,
      },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });
    if (trip.partner?.isRestricted) return res.status(404).json({ error: "Not found" });
    if (!publiclyDiscoverable || !trip.isPublic) {
      return res.status(404).json({ error: "Not found" });
    }
    if (trip.status !== "accepting_applications") return res.status(404).json(applicationsNotOpen(trip));
    res.json(shapeTripForApplicant(trip, settings, await loadApplicantQuestions(trip.id)));
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
        ...tripPartnerSelect,
      },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });
    if (trip.status !== "accepting_applications") return res.status(404).json(applicationsNotOpen(trip));
    res.json(shapeTripForApplicant(trip, settings, await loadApplicantQuestions(trip.id)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
