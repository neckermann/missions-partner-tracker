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
  verifyTripParticipantAccessToken,
  sendTripParticipantAccessLinks,
} = require("../utils/tripAccessToken");
const { buildSignedDocumentPdf } = require("../utils/pdfGeneration");
const { decodePhotoDataUrl } = require("../utils/participantPhoto");
const { renderSubscriberPage } = require("../utils/subscriberPage");
const crypto = require("crypto");

const router = express.Router();

async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      onlineGivingUrl: true,
      onlineGivingInstructions: true,
      collectDonorContactInfo: true,
      collectApplicantAddress: true,
      collectEmergencyContact: true,
      collectDateOfBirth: true,
      requireDateOfBirth: true,
      allowPublicSupportRaisingLinks: true,
      allowPrivateApplicationLinks: true,
      tripApplicationTemplate: true,
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
    fieldDisplayName: partnerFieldLabel(trip.partner),
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
    // Forced on for this trip specifically when it collects parent/
    // guardian info -- minor support can't function without a real date
    // of birth on file, regardless of the church-wide default. See
    // ChurchSettings.collectDateOfBirth's own schema comment.
    collectDateOfBirth: settings?.collectDateOfBirth !== false || !!trip.collectParentGuardianInfo,
    requireDateOfBirth: !!settings?.requireDateOfBirth || !!trip.collectParentGuardianInfo,
    // Per-trip, not church-wide -- see Trip.collectParentGuardianInfo's
    // own schema comment.
    collectParentGuardianInfo: !!trip.collectParentGuardianInfo,
  };
}

const tripPartnerSelect = {
  partner: { select: { displayName: true, fieldDisplayName: true, isRestricted: true } },
};

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
        collectParentGuardianInfo: true,
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
        collectParentGuardianInfo: true,
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

const applicationSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  // Structured mailing address -- optional strings, no format validation,
  // matching SendingParty's own looseness. Rendered on the public form
  // only when ChurchSettings.collectApplicantAddress is on, but accepted
  // here regardless of that setting's current value (same reasoning as
  // every other optional field on this schema -- the setting controls
  // what the form shows, not what the server will accept).
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateProvinceRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  // Structured emergency contact -- same looseness/reasoning as the
  // address fields above. Rendered only when ChurchSettings.
  // collectEmergencyContact is on, but accepted here regardless.
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  emergencyContactEmail: z.string().optional().nullable(),
  // Real structured field, not a template question -- see
  // ChurchSettings.collectDateOfBirth's own schema comment for why.
  dateOfBirth: z.coerce.date().optional().nullable(),
  // Only meaningful when this trip's own collectParentGuardianInfo is
  // on, but accepted regardless (same looseness as every other optional
  // field on this schema).
  parentGuardianName: z.string().optional().nullable(),
  parentGuardianRelationship: z.string().optional().nullable(),
  parentGuardianPhone: z.string().optional().nullable(),
  parentGuardianEmail: z.string().optional().nullable(),
  // A checkboxes-type question answers with a string array (every option
  // checked); every other type answers with a plain string -- see
  // utils/applicationQuestions.js's QUESTION_TYPES.
  responses: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});

async function createApplication(trip, settings, body, res) {
  const data = applicationSchema.parse(body);
  // The one field on this whole form that's ever actually enforced
  // server-side, not just shown-or-not -- see
  // ChurchSettings.requireDateOfBirth's own schema comment for why date
  // of birth specifically earns real enforcement where address/
  // emergency contact deliberately don't.
  const dobRequired = !!settings?.requireDateOfBirth || !!trip.collectParentGuardianInfo;
  if (dobRequired && !data.dateOfBirth) {
    return res.status(400).json({ error: "Date of birth is required to apply for this trip." });
  }
  await prisma.tripApplication.create({
    data: {
      tripId: trip.id,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      addressLine1: data.addressLine1 || null,
      addressLine2: data.addressLine2 || null,
      city: data.city || null,
      stateProvinceRegion: data.stateProvinceRegion || null,
      postalCode: data.postalCode || null,
      country: data.country || null,
      dateOfBirth: data.dateOfBirth || null,
      parentGuardianName: data.parentGuardianName || null,
      parentGuardianRelationship: data.parentGuardianRelationship || null,
      parentGuardianPhone: data.parentGuardianPhone || null,
      parentGuardianEmail: data.parentGuardianEmail || null,
      emergencyContactName: data.emergencyContactName || null,
      emergencyContactPhone: data.emergencyContactPhone || null,
      emergencyContactEmail: data.emergencyContactEmail || null,
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
      select: {
        id: true,
        status: true,
        isPublic: true,
        collectParentGuardianInfo: true,
        partner: { select: { isRestricted: true } },
      },
    });
    if (!trip || trip.partner?.isRestricted) return res.status(404).json({ error: "Not found" });
    if (!publiclyDiscoverable || !trip.isPublic || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    await createApplication(trip, settings, req.body, res);
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
      select: { id: true, status: true, collectParentGuardianInfo: true },
    });
    if (!trip || trip.status !== "accepting_applications") {
      return res.status(404).json({ error: "Not found" });
    }
    await createApplication(trip, settings, req.body, res);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/trip-participants/by-token/:shareToken -- the public
// support-raising page. 404s when allowPublicSupportRaisingLinks is off or the
// token doesn't match anything. Restricted partner: masked, not 404.
router.get("/participants/by-token/:shareToken", requireFeature("trips"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.allowPublicSupportRaisingLinks) return res.status(404).json({ error: "Not found" });

    const participant = await prisma.tripParticipant.findUnique({
      where: { shareToken: req.params.shareToken },
      include: {
        trip: {
          select: {
            name: true,
            type: true,
            description: true,
            startDate: true,
            endDate: true,
            ...tripPartnerSelect,
          },
        },
        contributions: { select: { amount: true } },
      },
    });
    if (!participant) return res.status(404).json({ error: "Not found" });
    if (participant.trip.partner?.isRestricted) {
      // still render -- masked -- rather than 404ing.
    }

    const raised = participant.contributions.reduce((sum, c) => sum + c.amount, 0);

    res.json({
      id: participant.id,
      firstName: participant.firstName,
      lastName: participant.lastName,
      story: participant.story,
      hasPhoto: !!participant.photo,
      supportRaisingGoal: participant.supportRaisingGoal,
      raised,
      trip: {
        name: participant.trip.name,
        type: participant.trip.type,
        // Unmasked here same as name/dates already are on this route --
        // this file's own header comment: masking on this route applies
        // to partner identity, not trip-level free text. No restricted-
        // partner branch needed.
        description: participant.trip.description,
        startDate: participant.trip.startDate,
        endDate: participant.trip.endDate,
        fieldDisplayName: partnerFieldLabel(participant.trip.partner),
      },
      // Never flightSegments, never donor contact info -- public mode only.
      giving: {
        onlineGivingUrl: settings.onlineGivingUrl || null,
        onlineGivingInstructions: settings.onlineGivingInstructions || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

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
            flightSegments: {
              orderBy: { departureAt: "asc" },
              include: { participants: { select: { id: true } } },
            },
            meetings: true,
            documents: { where: { OR: [{ participantId: payload.id }, { participantId: null }] } },
            requirements: { include: { requirementStatuses: { where: { participantId: payload.id } } } },
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
    // Generalized (#252 follow-on) -- every requirement, not just
    // missing ones, so the self-service page can show a due date and a
    // done/needed state per item rather than only ever a flat "still
    // needed" list. Fulfillment: a "document" row is the existing
    // anti-join against TripDocument; a "task" row is this participant's
    // own TripRequirementStatus.completedAt (already scoped to just this
    // participant by the `where` on requirementStatuses above).
    const requirements = participant.trip.requirements.map((req) => ({
      id: req.id,
      label: req.label,
      kind: req.kind,
      dueAt: req.dueAt,
      // Only meaningful for kind: "esignature" -- the agreement text to
      // show before signing. Harmless to always include; null for the
      // other two kinds.
      bodyText: req.bodyText,
      fulfilled:
        req.kind === "task"
          ? !!req.requirementStatuses[0]?.completedAt
          : participant.trip.documents.some(
              (d) => d.requirementId === req.id && d.participantId === participant.id
            ),
    }));

    res.json({
      id: participant.id,
      firstName: participant.firstName,
      lastName: participant.lastName,
      story: participant.story,
      hasPhoto: !!participant.photo,
      // Previously omitted entirely -- the self-service page had no way
      // to show (or even know about) the participant's own public link.
      shareToken: participant.shareToken,
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
        // A segment with nobody selected applies to the whole team; one
        // with people selected only applies to the ones among them --
        // filtered server-side (issue #265) so this participant's own
        // page can't be used to enumerate who else is on a segment.
        flightSegments: participant.trip.flightSegments
          .filter((seg) => seg.participants.length === 0 || seg.participants.some((p) => p.id === participant.id))
          .map(({ participants, ...seg }) => seg),
        fieldDisplayName:
          participant.trip.partner?.fieldDisplayName || participant.trip.partner?.displayName || null,
      },
      // Cancelled meetings are dropped here, not just marked -- a
      // participant already got an emailed cancellation notice; leaving
      // a cancelled entry sitting in their itinerary (even labeled) is
      // more likely to read as "is this still happening?" than as
      // useful record-keeping, which is what the admin side's own
      // (unfiltered) view is for instead.
      meetings: participant.trip.meetings.filter((m) => !m.cancelledAt),
      requirements,
      giving: {
        onlineGivingUrl: settings?.onlineGivingUrl || null,
        onlineGivingInstructions: settings?.onlineGivingInstructions || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

const signSchema = z.object({
  token: z.string(),
  signerName: z.string().min(1),
  // "self" | "parent/guardian" -- recordkeeping only, see
  // TripDocument.signerRelationship's own schema comment for why this
  // is never verified against anything.
  signerRelationship: z.string().optional().nullable(),
  // Base64 data URL from the self-service page's canvas, e.g.
  // "data:image/png;base64,...." -- optional, since a participant may
  // choose to just type their name instead of drawing. Stripped to raw
  // bytes below; never trusted as anything but opaque image bytes.
  signatureImage: z.string().optional().nullable(),
});

// POST /api/public/trips/participants/sign/:requirementId -- the one
// write action this otherwise read-only self-service surface has. Same
// signed-access-token authentication as GET /participants/access above
// (token in the body here, since this is a POST, not a query string) --
// no admin login involved, matching how a participant reaches every
// other self-service view.
router.post("/participants/sign/:requirementId", requireFeature("trips"), async (req, res, next) => {
  try {
    const { token, signerName, signerRelationship, signatureImage } = signSchema.parse(req.body);

    const payload = verifyTripParticipantAccessToken(token);
    if (!payload) return res.status(401).json({ error: "Invalid or expired link" });

    const participant = await prisma.tripParticipant.findUnique({
      where: { id: payload.id },
      include: { trip: { select: { name: true, type: true } } },
    });
    if (!participant || participant.accessTokenVersion !== payload.v) {
      return res.status(401).json({ error: "Invalid or expired link" });
    }

    const requirement = await prisma.tripRequirement.findUnique({ where: { id: req.params.requirementId } });
    if (!requirement || requirement.tripId !== participant.tripId) {
      return res.status(404).json({ error: "Not found" });
    }
    if (requirement.kind !== "esignature") {
      return res.status(400).json({ error: "This requirement doesn't accept a signature" });
    }
    const alreadySigned = await prisma.tripDocument.findFirst({
      where: { requirementId: requirement.id, participantId: participant.id },
      select: { id: true },
    });
    if (alreadySigned) {
      return res.status(400).json({ error: "This has already been signed" });
    }

    const documentText = requirement.bodyText || "";
    // Computed server-side, never trusted from the client -- the whole
    // point of the hash is to detect a later edit to the requirement's
    // own bodyText, which only matters if the server is the one who
    // decided what was signed.
    const documentTextHash = crypto.createHash("sha256").update(documentText, "utf8").digest("hex");
    const attestedAt = new Date();

    let signatureImageBuffer = null;
    if (signatureImage) {
      const base64 = signatureImage.replace(/^data:image\/\w+;base64,/, "");
      signatureImageBuffer = Buffer.from(base64, "base64");
    }

    // The audit trail lives directly on the generated TripDocument now
    // (merged from the former, separate TripSignature side table) --
    // it's the one artifact anyone (an admin, or the signer) ever
    // actually looks at, so the audit fields belong on it directly
    // rather than in a second row nobody browses independently.
    const ip = req.ip || req.socket?.remoteAddress || null;

    const pdfBytes = await buildSignedDocumentPdf({
      requirementLabel: requirement.label,
      tripLabel: participant.trip?.name || participant.trip?.type || "Trip",
      participantName: [participant.firstName, participant.lastName].filter(Boolean).join(" ") || null,
      documentText,
      signerName,
      signatureImage: signatureImageBuffer,
      attestedAt,
      documentTextHash,
      ip,
    });

    const tripDocument = await prisma.tripDocument.create({
      data: {
        tripId: participant.tripId,
        participantId: participant.id,
        requirementId: requirement.id,
        title: requirement.label,
        bytes: pdfBytes,
        fileName: `${requirement.label.replace(/[^a-z0-9]+/gi, "-")}.pdf`,
        contentType: "application/pdf",
        signerName,
        signerRelationship: signerRelationship || null,
        signatureImage: signatureImageBuffer,
        attestedAt,
        ip,
        documentTextSnapshot: documentText,
        documentTextHash,
      },
      omit: { bytes: true },
    });

    res.status(201).json({ tripDocumentId: tripDocument.id });
  } catch (err) {
    next(err);
  }
});

const selfServiceUpdateSchema = z.object({
  token: z.string(),
  story: z.string().optional().nullable(),
  // Base64 data URL, same shape the e-signature canvas already uses.
  photo: z.string().optional().nullable(),
  photoContentType: z.string().optional().nullable(),
});

// PUT /api/public/trip-participants/self-service -- the one other write
// action this surface has, alongside signing. One combined route for
// both story and photo edits (one actor, one trust boundary, same
// reasoning as the sign route above not being split further) -- no
// review step, confirmed acceptable: a participant already self-reports
// address/emergency-contact/application answers today with no review.
router.put("/participants/self-service", requireFeature("trips"), async (req, res, next) => {
  try {
    const { token, story, photo, photoContentType } = selfServiceUpdateSchema.parse(req.body);
    const payload = verifyTripParticipantAccessToken(token);
    if (!payload) return res.status(401).json({ error: "Invalid or expired link" });

    const participant = await prisma.tripParticipant.findUnique({ where: { id: payload.id } });
    if (!participant || participant.accessTokenVersion !== payload.v) {
      return res.status(401).json({ error: "Invalid or expired link" });
    }

    const data = {};
    if (story !== undefined) data.story = story?.trim() || null;
    if (photo) data.photo = decodePhotoDataUrl(photo, photoContentType);
    if (photo && photoContentType) data.photoContentType = photoContentType;

    await prisma.tripParticipant.update({ where: { id: participant.id }, data });
    res.json({ saved: true });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// GET /api/public/trip-participants/:id/photo -- unauthenticated and
// deliberately so: a participant's own photo is meant to be public (it's
// of them, not the destination), unlike TripDocument, which is private
// and admin-authenticated to download. Serves the self-service <img>,
// the public <img>, and the admin's own preview -- one shared route,
// not one per audience.
router.get("/participants/:id/photo", requireFeature("trips"), async (req, res, next) => {
  try {
    const participant = await prisma.tripParticipant.findUnique({
      where: { id: req.params.id },
      select: { photo: true, photoContentType: true },
    });
    if (!participant || !participant.photo) return res.status(404).json({ error: "Not found" });
    res.set("Content-Type", participant.photoContentType || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(participant.photo);
  } catch (err) {
    next(err);
  }
});

const RSVP_RESPONSES = new Set(["yes", "no", "maybe"]);
const RSVP_PAGE_LABELS = { yes: "attending", no: "not attending", maybe: "a maybe" };

// GET /api/public/trips/meetings/:meetingId/rsvp?token=...&response=yes --
// issue #267's RSVP design decision: link-based only, no inbound email.
// GET, not POST, because this has to work from a plain click in a mail
// client with no JS -- same precedent routes/publicUnsubscribe.js's own
// GET already follows for a mutating, click-from-email action. Renders
// an HTML page (renderSubscriberPage, shared with confirm/unsubscribe),
// never JSON -- a person clicking an email link needs to see a page,
// not a raw API response.
router.get("/meetings/:meetingId/rsvp", requireFeature("trips"), async (req, res, next) => {
  try {
    const response = String(req.query.response || "");
    if (!RSVP_RESPONSES.has(response)) {
      return res
        .status(400)
        .send(await renderSubscriberPage("This RSVP link is invalid.", "", "Meeting RSVP"));
    }

    const payload = verifyTripParticipantAccessToken(String(req.query.token || ""));
    if (!payload) {
      return res
        .status(401)
        .send(await renderSubscriberPage("This link is invalid or has expired.", "", "Meeting RSVP"));
    }

    const participant = await prisma.tripParticipant.findUnique({ where: { id: payload.id } });
    // Same accessTokenVersion check as /participants/access -- a
    // resend/regenerate bumps this, invalidating every previously-
    // issued link (RSVP links included, since they reuse the exact
    // same token) at once.
    if (!participant || participant.accessTokenVersion !== payload.v) {
      return res
        .status(401)
        .send(await renderSubscriberPage("This link is invalid or has expired.", "", "Meeting RSVP"));
    }

    const meeting = await prisma.tripMeeting.findUnique({ where: { id: req.params.meetingId } });
    if (!meeting || meeting.tripId !== participant.tripId) {
      return res.status(404).send(await renderSubscriberPage("This meeting couldn't be found.", "", "Meeting RSVP"));
    }
    // A cancelled meeting has nothing left to RSVP to -- an already-sent
    // link (from before the cancellation) should say so plainly rather
    // than silently recording a response to a meeting that isn't
    // happening.
    if (meeting.cancelledAt) {
      return res
        .status(400)
        .send(
          await renderSubscriberPage(
            "This meeting has been cancelled, so there's nothing left to RSVP to.",
            "",
            "Meeting RSVP"
          )
        );
    }

    // Upsert on (meetingId, participantId) -- clicking a different link
    // later (changing your mind) just overwrites the earlier response,
    // same idempotency precedent TripMeeting.cancelledAt's own route
    // already follows for re-cancelling.
    await prisma.tripMeetingRsvp.upsert({
      where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
      create: { meetingId: meeting.id, participantId: participant.id, response, respondedAt: new Date() },
      update: { response, respondedAt: new Date() },
    });

    res.send(
      await renderSubscriberPage(
        `Got it — you're marked as <strong>${RSVP_PAGE_LABELS[response]}</strong> for this meeting. You can click a different link in the email anytime to change your response.`,
        "",
        "Meeting RSVP"
      )
    );
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
