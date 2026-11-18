const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { generateShareToken, buildTripParticipantAccessUrl, appBaseUrl } = require("../utils/tripAccessToken");
const {
  sendParticipantEmail,
  buildMeetingIcs,
  buildMeetingEmailBody,
  buildTripDatesIcs,
} = require("../utils/tripEmails");
const { isFeatureEnabled } = require("../utils/features");
const { APPLICATION_QUESTION_SCHEMA } = require("../utils/applicationQuestions");
const { sendStoredFile } = require("../utils/fileResponse");
const { decodePhotoDataUrl } = require("../utils/participantPhoto");
const { tripDocumentUpload } = require("../utils/upload");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Gates the whole resource -- this router is the only writer for
// Trip/TripParticipant and every sibling model below.
router.use(requireFeature("trips"));

// Shared with the public self-service upload route (publicTrips.js) --
// same allowlist/size cap, one place to change either (backend/src/utils/upload.js).
const upload = tripDocumentUpload();

async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      allowPrivateApplicationLinks: true,
      allowPublicSupportRaisingLinks: true,
      inboundEmailAddress: true,
    },
  });
}

const participantSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.string().optional().nullable(),
  isLeader: z.boolean().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  // Optional override -- almost always left unset, in which case every
  // participant-creation route below defaults it to the trip's own
  // supportRaisingGoal at that moment (see defaultParticipantGoal).
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  // Only meaningful when the trip's own collectParentGuardianInfo is on
  // -- see Trip.collectParentGuardianInfo's own schema comment.
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentGuardianName: z.string().optional().nullable(),
  parentGuardianRelationship: z.string().optional().nullable(),
  parentGuardianPhone: z.string().optional().nullable(),
  parentGuardianEmail: z.string().optional().nullable(),
});

// A participant's own supportRaisingGoal is a plain, independently
// editable number (AdminTripParticipantDetail.jsx) -- but starting every
// new participant at null, even though almost every trip wants each
// person aiming for roughly the trip's own total, was pure friction.
// Applied once at creation time, not as a live display fallback --
// changing the trip's goal afterward never retroactively rewrites an
// already-created participant's own number.
function defaultParticipantGoal(participant, tripGoal) {
  return participant.supportRaisingGoal !== undefined ? participant.supportRaisingGoal : tripGoal ?? null;
}

const tripSchema = z.object({
  partnerId: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  status: z.enum(["planning", "accepting_applications", "closed", "completed"]).optional(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  type: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  teamSizeMin: z.coerce.number().int().optional().nullable(),
  teamSizeMax: z.coerce.number().int().optional().nullable(),
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  isPublic: z.boolean().optional(),
  collectParentGuardianInfo: z.boolean().optional(),
  applicationQuestions: APPLICATION_QUESTION_SCHEMA.optional().nullable(),
  albumProvider: z.enum(["google_photos", "icloud", "other"]).optional().nullable(),
  albumUrl: z.string().optional().nullable(),
  participants: z.array(participantSchema).optional(),
});

function datesInOrder(data) {
  if (!data.startDate || !data.endDate) return true;
  return data.endDate >= data.startDate;
}
const DATE_ORDER_ISSUE = { message: "endDate cannot be before startDate", path: ["endDate"] };

const ALBUM_URL_PATTERNS = {
  google_photos: /^https:\/\/photos\.(app\.goo\.gl|google\.com)\//i,
  icloud: /^https:\/\/(www\.)?icloud\.com\/(sharedalbum|photos)\//i,
  other: /^https?:\/\/.+\..+/,
};
function albumLinkValid(data) {
  if (!data.albumProvider && !data.albumUrl) return true;
  if (!data.albumProvider || !data.albumUrl) return false;
  return ALBUM_URL_PATTERNS[data.albumProvider].test(data.albumUrl.trim());
}
const ALBUM_LINK_ISSUE = {
  message: "Enter a valid album link for the selected provider",
  path: ["albumUrl"],
};

const tripQuerySchema = z.object({
  partnerId: z.string().optional(),
  type: z.string().optional(),
  year: z.coerce.number().int().optional(),
});

const tripPartnerInclude = {
  select: { id: true, kind: true, displayName: true, fieldDisplayName: true, isRestricted: true },
};

const tripInclude = {
  partner: tripPartnerInclude,
  // omit: raw photo bytes have no business in every trip list/detail
  // response -- the admin UI uses the dedicated GET
  // /public/trips/participants/:id/photo route to render one, same as
  // the public/self-service pages do.
  participants: { omit: { photo: true } },
  // Needed on the plain list endpoint too (not just GET /:id, which
  // already spread this in separately below) -- the Unmatched Emails
  // queue flattens every trip's participants into one picker and needs
  // each trip's own requirement list on hand to populate the document-
  // requirement picker without a second round-trip per trip.
  // requirementStatuses carries each requirement's per-participant
  // completedAt/reminderSentAt (#252 generalization) -- needed wherever
  // a task's fulfillment is shown, which a document-only anti-join can't
  // answer.
  requirements: { include: { requirementStatuses: true } },
  // Added when AdminTripDashboard.jsx (issue #259) folded into
  // AdminTrips.jsx -- that page's own "Raised" column needed this same
  // amount-only projection, previously fetched only by the now-removed
  // GET /dashboard route.
  contributions: { select: { amount: true } },
  budgetLines: true,
  flightSegments: {
    orderBy: { departureAt: "asc" },
    include: { participants: { select: { id: true, firstName: true, lastName: true } } },
  },
};

// GET /api/trips?partnerId=&type=&year=
router.get("/", async (req, res, next) => {
  try {
    const query = tripQuerySchema.parse(req.query);
    const where = {};
    if (query.partnerId) where.partnerId = query.partnerId;
    if (query.type) where.type = query.type;
    if (query.year) {
      where.startDate = {
        gte: new Date(Date.UTC(query.year, 0, 1)),
        lt: new Date(Date.UTC(query.year + 1, 0, 1)),
      };
    }
    const records = await prisma.trip.findMany({
      where,
      include: tripInclude,
      orderBy: { startDate: "desc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/trips/planning -- §3. Blends open/committed/fallback rows per
// partner with trip capacity fields set.
router.get("/planning", async (req, res, next) => {
  try {
    const partners = await prisma.partner.findMany({
      where: { archived: false, tripTypesSupported: { isEmpty: false } },
      select: {
        id: true,
        displayName: true,
        isRestricted: true,
        tripTeamSizeMin: true,
        tripTeamSizeMax: true,
        tripTypesSupported: true,
        tripSeasonNotes: true,
        tripLogisticsNotes: true,
        trips: {
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
            teamSizeMin: true,
            teamSizeMax: true,
            participants: true,
          },
        },
      },
    });

    const rows = partners.map((p) => {
      const open = p.trips.find((t) => ["planning", "accepting_applications"].includes(t.status));
      const committed = p.trips.find((t) => t.status === "closed");
      const completed = p.trips.filter((t) => t.status === "completed");
      const mostRecentCompleted = completed.sort(
        (a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0)
      )[0];
      const mostRecentAny = [...p.trips].sort(
        (a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0)
      )[0];
      return {
        partnerId: p.id,
        displayName: p.displayName,
        isRestricted: p.isRestricted,
        kind: open ? "open" : committed ? "committed" : "fallback",
        trip: open || committed || null,
        teamSizeMin: p.tripTeamSizeMin,
        teamSizeMax: p.tripTeamSizeMax,
        tripTypesSupported: p.tripTypesSupported,
        tripSeasonNotes: p.tripSeasonNotes,
        tripLogisticsNotes: p.tripLogisticsNotes,
        pastTripCount: completed.length,
        mostRecentPastTripDate: mostRecentCompleted?.startDate || null,
        cloneFromTripId: mostRecentAny?.id || null,
      };
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: {
        ...tripInclude,
        // Only on this single-trip detail route, not the plain list route
        // tripInclude is also shared with -- the approved applicant's own
        // custom-question answers are otherwise permanently stranded once
        // approval turns a TripApplication into a TripParticipant (the
        // `applications` key just below only ever holds *pending* rows).
        participants: {
          ...tripInclude.participants,
          include: { application: { select: { responses: true, submittedAt: true } } },
        },
        applications: { where: { status: "pending" } },
        // rsvps included so the admin Meetings UI can show a tally/
        // per-participant breakdown without a second round-trip.
        meetings: { include: { rsvps: true } },
        documents: true,
        contributions: true,
      },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });
    res.json(trip);
  } catch (err) {
    next(err);
  }
});

// POST /api/trips  (create — editor or admin)
//
// Auto-populates ChurchSettings.tripRequirementTemplate onto any newly-
// created trip that isn't a purely historical backfill (status !==
// "completed" -- a backfill already happened, there's nothing left to
// sign/fulfill). A one-time snapshot copy, not a live link to the
// template -- see tripRequirementTemplate's own schema comment for why.
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = tripSchema
      .refine(datesInOrder, DATE_ORDER_ISSUE)
      .refine(albumLinkValid, ALBUM_LINK_ISSUE)
      .parse(req.body);

    let requirementTemplate = [];
    // Guards against the Trip model's own `status` default ("completed")
    // applying when the caller omits it -- that case must NOT get the
    // template either, same as an explicit "completed" backfill.
    if (data.status && data.status !== "completed") {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { tripRequirementTemplate: true },
      });
      requirementTemplate = settings?.tripRequirementTemplate || [];
    }

    const created = await prisma.trip.create({
      data: {
        ...data,
        participants: participants?.length
          ? {
              create: participants.map((p) => ({
                ...p,
                supportRaisingGoal: defaultParticipantGoal(p, data.supportRaisingGoal),
              })),
            }
          : undefined,
        requirements: requirementTemplate.length
          ? {
              create: requirementTemplate.map((r) => ({
                label: r.label,
                kind: r.kind,
                bodyText: r.bodyText || null,
                reminderLeadDays: r.reminderLeadDays || null,
              })),
            }
          : undefined,
      },
      include: tripInclude,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = tripSchema
      .partial()
      .refine(datesInOrder, DATE_ORDER_ISSUE)
      .refine(albumLinkValid, ALBUM_LINK_ISSUE)
      .parse(req.body);

    const existing = await prisma.trip.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    // The goal actually in effect once this update applies -- this call's
    // own value if it's touching supportRaisingGoal, otherwise whatever
    // the trip already had.
    const effectiveGoal = data.supportRaisingGoal !== undefined ? data.supportRaisingGoal : existing.supportRaisingGoal;

    // Same "did this actually change" shape PUT /meetings/:id already uses
    // for its own reschedule-resend check -- only startDate/endDate count
    // (not every field this route can touch), and only when the incoming
    // value actually differs from what's stored (datesChanged helper
    // treats a present-but-unchanged field, or a field left out of this
    // request entirely, the same way: no resend).
    function dateChanged(incoming, current) {
      if (incoming === undefined) return false;
      const incomingTime = incoming ? new Date(incoming).getTime() : null;
      const currentTime = current ? new Date(current).getTime() : null;
      return incomingTime !== currentTime;
    }
    const datesChanged = dateChanged(data.startDate, existing.startDate) || dateChanged(data.endDate, existing.endDate);

    const updated = await prisma.$transaction(async (tx) => {
      if (participants !== undefined) {
        await tx.tripParticipant.deleteMany({ where: { tripId: req.params.id, applicationId: null } });
      }
      return tx.trip.update({
        where: { id: req.params.id },
        data: {
          ...data,
          participants:
            participants !== undefined
              ? {
                  create: participants.map((p) => ({
                    ...p,
                    supportRaisingGoal: defaultParticipantGoal(p, effectiveGoal),
                  })),
                }
              : undefined,
        },
        include: tripInclude,
      });
    });

    if (datesChanged) {
      await sendTripDatesUpdateEmail(updated);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.trip.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    await prisma.trip.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/trips/:id/clone -- §11. Copies reusable shape only, never
// participants/applications/meetings/documents/contributions. Gated by
// requireFeature("trips")+requireRole only -- not additionally gated,
// since cloning is a basic convenience over the Trip record itself.
router.post("/:id/clone", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const source = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: { requirements: true },
    });
    if (!source) return res.status(404).json({ error: "Not found" });

    const cloned = await prisma.trip.create({
      data: {
        partnerId: source.partnerId,
        name: source.name,
        type: source.type,
        teamSizeMin: source.teamSizeMin,
        teamSizeMax: source.teamSizeMax,
        description: source.description,
        supportRaisingGoal: source.supportRaisingGoal,
        applicationQuestions: source.applicationQuestions,
        collectParentGuardianInfo: source.collectParentGuardianInfo,
        status: "planning",
        // label/kind/bodyText/reminderLeadDays copy forward (a repeat
        // trip almost always wants the same checklist, including the
        // same agreement text for an esignature-kind row); dueAt does
        // NOT -- a specific calendar date from the prior run is never
        // right for the new one, same reasoning Trip's own startDate/
        // endDate aren't copied.
        requirements: {
          create: source.requirements.map((r) => ({
            label: r.label,
            kind: r.kind,
            bodyText: r.bodyText,
            reminderLeadDays: r.reminderLeadDays,
          })),
        },
      },
      include: tripInclude,
    });
    res.status(201).json(cloned);
  } catch (err) {
    next(err);
  }
});

// POST /api/trips/:id/generate-application-link -- §4. Requires
// ChurchSettings.allowPrivateApplicationLinks on.
router.post("/:id/generate-application-link", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.allowPrivateApplicationLinks) {
      return res
        .status(400)
        .json({ error: "Private application links are turned off -- enable them in Trip settings first" });
    }
    const existing = await prisma.trip.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    const updated = await prisma.trip.update({
      where: { id: req.params.id },
      data: { applicationShareToken: generateShareToken() },
      select: { applicationShareToken: true },
    });
    res.json({ applicationShareToken: updated.applicationShareToken });
  } catch (err) {
    next(err);
  }
});

// ---- Requirements (document or task, #252 generalization) ----

const requirementSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["document", "task", "esignature"]).optional(),
  // Only meaningful for kind: "esignature" -- the real agreement text a
  // participant signs. Not validated against kind here (a requirement
  // can be switched between kinds while editing; the frontend only shows
  // this field for esignature, but the backend doesn't need to enforce
  // it's empty for the other two).
  bodyText: z.string().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
  // Only meaningful alongside dueAt -- validated together below, not
  // enforced as a DB constraint (same style as this file's other
  // cross-field zod .refine()s).
  reminderLeadDays: z.coerce.number().int().positive().optional().nullable(),
});
function reminderNeedsDueDate(data) {
  return !data.reminderLeadDays || !!data.dueAt;
}
const REMINDER_NEEDS_DUE_DATE_ISSUE = {
  message: "Set a due date before adding a reminder lead time",
  path: ["reminderLeadDays"],
};

router.post("/:id/requirements", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = requirementSchema
      .refine(reminderNeedsDueDate, REMINDER_NEEDS_DUE_DATE_ISSUE)
      .parse(req.body);
    const created = await prisma.tripRequirement.create({ data: { tripId: req.params.id, ...data } });

    // document- and esignature-kind requirements are the two kinds a
    // participant can self-serve (the public upload route and the
    // existing "Sign now" flow) -- tell them it exists the same moment an
    // admin adds it, rather than leaving them to discover it only by
    // revisiting their own trip page on their own. "task" stays excluded:
    // there's nothing for a participant to do from this email for one --
    // an admin checks it off, so a notice would just be noise.
    if (created.kind === "document" || created.kind === "esignature") {
      const trip = await prisma.trip.findUnique({
        where: { id: req.params.id },
        include: { participants: true },
      });
      await sendRequirementNotificationEmail(trip, created, trip?.participants || []);
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/requirements/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = requirementSchema
      .partial()
      .refine(reminderNeedsDueDate, REMINDER_NEEDS_DUE_DATE_ISSUE)
      .parse(req.body);
    const updated = await prisma.tripRequirement.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/requirements/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    await prisma.tripRequirement.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Budget lines (planned-expense tracking, trip-wide, estimate-only
// for v1 -- no actualAmount, see TripBudgetLine's own schema comment) ----

const budgetLineSchema = z.object({
  label: z.string().min(1),
  estimatedAmount: z.coerce.number().int(),
});

router.post("/:id/budget-lines", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = budgetLineSchema.parse(req.body);
    const created = await prisma.tripBudgetLine.create({ data: { tripId: req.params.id, ...data } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/budget-lines/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = budgetLineSchema.partial().parse(req.body);
    const updated = await prisma.tripBudgetLine.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/budget-lines/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    await prisma.tripBudgetLine.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Flight segments -- replaces the former Trip.flightDetails free-text
// field. Same CRUD shape as budget lines above, except participantIds
// (issue #265) -- a real relation, not a free-text label of who's on
// it. Omitted or empty means the whole team; the self-service page
// (publicTrips.js) filters on this, the admin view never does.
const flightSegmentSchema = z.object({
  participantIds: z.array(z.string()).optional(),
  airline: z.string().optional().nullable(),
  flightNumber: z.string().optional().nullable(),
  departureAirport: z.string().optional().nullable(),
  departureAt: z.coerce.date().optional().nullable(),
  arrivalAirport: z.string().optional().nullable(),
  arrivalAt: z.coerce.date().optional().nullable(),
});

router.post("/:id/flight-segments", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participantIds, ...data } = flightSegmentSchema.parse(req.body);
    const created = await prisma.tripFlightSegment.create({
      data: {
        tripId: req.params.id,
        ...data,
        participants: participantIds?.length ? { connect: participantIds.map((id) => ({ id })) } : undefined,
      },
      include: { participants: { select: { id: true, firstName: true, lastName: true } } },
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/flight-segments/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participantIds, ...data } = flightSegmentSchema.partial().parse(req.body);
    const updated = await prisma.tripFlightSegment.update({
      where: { id: req.params.id },
      data: {
        ...data,
        // `set` replaces the whole relation outright -- the admin UI
        // always sends the complete selected list, never a delta.
        participants: participantIds !== undefined ? { set: participantIds.map((id) => ({ id })) } : undefined,
      },
      include: { participants: { select: { id: true, firstName: true, lastName: true } } },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/flight-segments/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    await prisma.tripFlightSegment.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PUT /api/trips/requirements/:id/participants/:participantId/complete --
// task-kind only (a document's fulfillment is always the existing
// anti-join against TripDocument, never this). Upsert, not a plain
// update, since most participant/requirement pairs have no
// TripRequirementStatus row until the first time either this or the
// reminder scheduler needs one.
router.put(
  "/requirements/:id/participants/:participantId/complete",
  requireRole("admin", "editor"),
  async (req, res, next) => {
    try {
      const { completed } = z.object({ completed: z.boolean() }).parse(req.body);
      const requirement = await prisma.tripRequirement.findUnique({ where: { id: req.params.id } });
      if (!requirement) return res.status(404).json({ error: "Not found" });
      if (requirement.kind !== "task") {
        return res.status(400).json({
          error:
            "Only a task requirement can be marked complete directly -- a document or e-signature requirement is fulfilled by its own document, not this",
        });
      }
      const status = await prisma.tripRequirementStatus.upsert({
        where: {
          requirementId_participantId: {
            requirementId: req.params.id,
            participantId: req.params.participantId,
          },
        },
        create: {
          requirementId: req.params.id,
          participantId: req.params.participantId,
          completedAt: completed ? new Date() : null,
        },
        update: { completedAt: completed ? new Date() : null },
      });
      res.json(status);
    } catch (err) {
      next(err);
    }
  }
);

// ---- Applications ----

router.get("/:id/applications", async (req, res, next) => {
  try {
    const applications = await prisma.tripApplication.findMany({ where: { tripId: req.params.id } });
    res.json(applications);
  } catch (err) {
    next(err);
  }
});

// PUT /api/trips/applications/:id -- approve/decline. Approving creates
// exactly one TripParticipant with applicationId set (the @unique
// constraint on that column rejects a second approval of the same
// application), copying firstName/lastName at that moment, and fires
// the trip-dates team invite (§9) once, only for a non-completed trip.
router.put("/applications/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { status, declinedReason } = z
      .object({
        status: z.enum(["approved", "declined", "pending"]),
        declinedReason: z.string().optional().nullable(),
      })
      .parse(req.body);
    // meetings/requirements included alongside trip -- needed for
    // sendLateJoinerCatchUpEmails below, same shape POST /:id/participants
    // already loads its own trip with.
    const application = await prisma.tripApplication.findUnique({
      where: { id: req.params.id },
      include: { trip: { include: { meetings: true, requirements: true } } },
    });
    if (!application) return res.status(404).json({ error: "Not found" });

    // Fetched once, before the transaction -- decides both whether this
    // new participant gets a support-raising shareToken at all (below)
    // and whether the team-invite email fires (after the transaction).
    const settings = await getSettings();

    const updated = await prisma.$transaction(async (tx) => {
      const app = await tx.tripApplication.update({
        where: { id: req.params.id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedById: req.user.id,
          // Admin-only context for a decline, never shown to the
          // applicant. Reconsidering back to "pending" (the undo path)
          // clears it -- a reopened application has no reason attached
          // to it anymore, since the prior decline no longer stands.
          declinedReason: status === "declined" ? declinedReason?.trim() || null : null,
        },
      });
      if (status === "approved") {
        const participant = await tx.tripParticipant.create({
          data: {
            tripId: application.tripId,
            applicationId: application.id,
            firstName: application.firstName,
            lastName: application.lastName,
            email: application.email,
            phone: application.phone,
            addressLine1: application.addressLine1,
            addressLine2: application.addressLine2,
            city: application.city,
            stateProvinceRegion: application.stateProvinceRegion,
            postalCode: application.postalCode,
            country: application.country,
            emergencyContactName: application.emergencyContactName,
            emergencyContactPhone: application.emergencyContactPhone,
            emergencyContactEmail: application.emergencyContactEmail,
            dateOfBirth: application.dateOfBirth,
            parentGuardianName: application.parentGuardianName,
            parentGuardianRelationship: application.parentGuardianRelationship,
            parentGuardianPhone: application.parentGuardianPhone,
            parentGuardianEmail: application.parentGuardianEmail,
            // Defaulted to the trip's own goal -- same reasoning as the
            // direct-add route (defaultParticipantGoal), just inlined
            // since there's no per-participant override to weigh against
            // here (approval carries no participant-shaped input of its
            // own to read one from).
            supportRaisingGoal: application.trip.supportRaisingGoal,
            // Auto-generated here, not left for a later manual admin
            // click -- the church-wide setting already answers "do we do
            // this at all," so a second per-participant step is pure
            // friction. See the team-invite email below, which is the
            // one place this new link actually reaches the participant.
            shareToken: settings?.allowPublicSupportRaisingLinks ? generateShareToken() : null,
          },
        });
        return { app, participant };
      }
      return { app, participant: null };
    });

    // Trip-dates team invite (§9) -- fires once, outside the
    // transaction (an email failure shouldn't roll back the approval).
    // Previously carried zero links at all -- a participant had no way to
    // ever receive their own access link or support-raising link
    // automatically. Now carries both, in one email, rather than a
    // second dedicated send for the support-raising link.
    if (
      updated.participant &&
      application.trip.status !== "completed" &&
      application.trip.startDate &&
      application.trip.endDate
    ) {
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        const accessUrl = buildTripParticipantAccessUrl(updated.participant);
        const supportRaisingLine = updated.participant.shareToken
          ? `\n\nYour support-raising page (share this with family and friends): ${appBaseUrl()}/trip-support-raising/${updated.participant.shareToken}`
          : "";
        await sendParticipantEmail(
          updated.participant,
          `You're on the team: ${application.trip.name || application.trip.type || "your trip"}`,
          `You've been approved for the trip -- attached is a calendar invite for the trip dates.\n\nYour trip page: ${accessUrl}${supportRaisingLine}`,
          {
            attachments: [
              {
                name: "trip-dates.ics",
                content: Buffer.from(buildTripDatesIcs(application.trip)),
                contentType: "text/calendar",
              },
            ],
          }
        );
      }
    }

    // Same late-joiner catch-up as the direct-add route below -- approving
    // an application is a separate creation path (its own tx.create above)
    // that previously got none of this. Not gated on startDate/endDate
    // existing (unlike the welcome email above, which needs them for its
    // .ics) -- sendLateJoinerCatchUpEmails only needs trip.status itself.
    if (updated.participant) {
      await sendLateJoinerCatchUpEmails(application.trip, updated.participant);
    }

    res.json(updated.app);
  } catch (err) {
    next(err);
  }
});

// ---- Team: direct admin add ----

router.post("/:id/participants", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = participantSchema
      .extend({ email: z.string().email().optional().nullable() })
      .parse(req.body);
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: { meetings: true, requirements: true },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });

    // A participant on a completed trip is a backfill by construction
    // (recruiting never happens for an already-finished trip) and
    // legitimately has none of this on file; a participant added to any
    // other trip status is being asserted as a real, reachable team
    // member the moment they're added -- application approval already
    // enforces this, this route previously didn't.
    if (trip.status !== "completed" && (!data.firstName || !data.lastName || !data.email)) {
      return res.status(400).json({
        error: "First name, last name, and email are required for a participant on an active trip.",
      });
    }

    const settings = await getSettings();
    const participant = await prisma.tripParticipant.create({
      data: {
        ...data,
        tripId: trip.id,
        supportRaisingGoal: defaultParticipantGoal(data, trip.supportRaisingGoal),
        // Same auto-generation as the application-approval path -- see
        // that route's own comment for why this isn't left as a manual
        // admin step.
        shareToken: settings?.allowPublicSupportRaisingLinks ? generateShareToken() : null,
      },
    });

    if (trip.status !== "completed" && trip.startDate && trip.endDate) {
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        const accessUrl = buildTripParticipantAccessUrl(participant);
        const supportRaisingLine = participant.shareToken
          ? `\n\nYour support-raising page (share this with family and friends): ${appBaseUrl()}/trip-support-raising/${participant.shareToken}`
          : "";
        await sendParticipantEmail(
          participant,
          `You're on the team: ${trip.name || trip.type || "your trip"}`,
          `Attached is a calendar invite for the trip dates.\n\nYour trip page: ${accessUrl}${supportRaisingLine}`,
          {
            attachments: [
              {
                name: "trip-dates.ics",
                content: Buffer.from(buildTripDatesIcs(trip)),
                contentType: "text/calendar",
              },
            ],
          }
        );
      }
    }

    // A participant added after meetings or document requirements already
    // exist would otherwise never learn about them -- the welcome email
    // above only covers the trip dates. Shared with the application-
    // approval route (PUT /applications/:id), which needs the exact same
    // backfill through a different creation path.
    await sendLateJoinerCatchUpEmails(trip, participant);

    res.status(201).json(participant);
  } catch (err) {
    next(err);
  }
});

// POST /api/trips/participants/:id/generate-support-raising-link --
// "Regenerate" on the frontend once a token already exists (overwrite-
// as-revocation, same precedent Trip.applicationShareToken's own
// regenerate already uses) -- this route itself needed no change for
// that, only the frontend's own !shareToken gating, which previously
// hid the button forever once a token existed.
router.post(
  "/participants/:id/generate-support-raising-link",
  requireRole("admin", "editor"),
  async (req, res, next) => {
    try {
      const settings = await getSettings();
      if (!settings?.allowPublicSupportRaisingLinks) {
        return res.status(400).json({
          error: "Public support-raising links are turned off -- enable them in Trip settings first",
        });
      }
      const participant = await prisma.tripParticipant.update({
        where: { id: req.params.id },
        data: { shareToken: generateShareToken() },
        select: { shareToken: true },
      });
      res.json({ shareToken: participant.shareToken });
    } catch (err) {
      next(err);
    }
  }
);

const adminParticipantUpdateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  isLeader: z.boolean().optional(),
  supportRaisingGoal: z.coerce.number().int().optional().nullable(),
  // Address/emergency contact -- previously write-once (copied from the
  // originating TripApplication on approval, see the approval route
  // above) with no admin edit path afterward, and no way at all for a
  // directly-added participant (no application) to ever get these set.
  // Now plain editable record-keeping, same trust level as
  // firstName/phone/etc. above.
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateProvinceRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  emergencyContactEmail: z.string().optional().nullable(),
  // Same treatment, only meaningful when the trip's own
  // collectParentGuardianInfo is on.
  dateOfBirth: z.coerce.date().optional().nullable(),
  parentGuardianName: z.string().optional().nullable(),
  parentGuardianRelationship: z.string().optional().nullable(),
  parentGuardianPhone: z.string().optional().nullable(),
  parentGuardianEmail: z.string().optional().nullable(),
  story: z.string().optional().nullable(),
  photo: z.string().optional().nullable(),
  photoContentType: z.string().optional().nullable(),
});

// PUT /api/trips/participants/:id -- one combined admin route for
// everything an admin can edit on a participant's behalf: basic contact
// details (never gated -- this is plain record-keeping, independent of
// whether the church uses public support-raising pages at all) and
// story/photo (editing on their behalf what a participant could also
// edit themselves via the self-service route -- same fields, different
// trust boundary: this one is admin-authenticated, not signed-access-
// token-authenticated).
router.put("/participants/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { photo, photoContentType, ...rest } = adminParticipantUpdateSchema.parse(req.body);
    const data = { ...rest };
    if (photo) data.photo = decodePhotoDataUrl(photo, photoContentType);
    if (photo && photoContentType) data.photoContentType = photoContentType;

    // omit: the raw photo bytes have no business in a JSON response --
    // same reasoning the sign route already applies to TripDocument.bytes.
    const participant = await prisma.tripParticipant.update({
      where: { id: req.params.id },
      data,
      omit: { photo: true },
    });
    res.json(participant);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/trips/participants/:id/request-access-link -- admin-triggered
// resend of a participant's own self-service link (distinct from the
// public, self-triggered §4a lost-link flow).
router.post(
  "/participants/:id/request-access-link",
  requireRole("admin", "editor"),
  async (req, res, next) => {
    try {
      const participant = await prisma.tripParticipant.findUnique({ where: { id: req.params.id } });
      if (!participant) return res.status(404).json({ error: "Not found" });
      await sendParticipantEmail(
        participant,
        "Your trip access link",
        `Here's your trip link: ${buildTripParticipantAccessUrl(participant)}`
      );
      res.json({ sent: true });
    } catch (err) {
      next(err);
    }
  }
);

// ---- Meetings ----

const meetingInputSchema = z.object({
  startAt: z.coerce.date().optional(),
  location: z.string().optional().nullable(),
  // An empty string (clearing the field from a form input) is treated
  // the same as omitting it -- url() rejects "" outright, and clearing
  // a link should mean "no link," not a validation error.
  meetingLink: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  agenda: z.string().optional().nullable(),
});

// Shared by the requirement-creation route above and the late-joiner
// check in participant creation below -- same email, two different
// moments a participant can first become aware a document- or
// esignature-kind requirement applies to them (a new one gets added to
// their trip, or they get added to a trip that already has one). Covers
// both kinds (not "task", which has no participant-facing action) with
// one deliberately generic "checklist item" wording rather than kind-
// specific phrasing ("upload"/"sign") -- it already read as kind-neutral
// before esignature was added here, so no wording change was needed, just
// the broader scope. Gates and loops internally, same shape as
// sendMeetingEmail just below, so neither call site needs its own
// settings check.
async function sendRequirementNotificationEmail(trip, requirement, participants) {
  const settings = await getSettings();
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;
  for (const participant of participants) {
    await sendParticipantEmail(
      participant,
      `New item needed: ${requirement.label}`,
      `A new item has been added to your checklist for ${trip.name || trip.type || "your trip"}: "${requirement.label}".\n\nYour trip page: ${buildTripParticipantAccessUrl(participant)}`
    );
  }
}

// Shared by both ways a participant can land on a trip after other things
// already exist on it -- a direct admin add (POST /:id/participants) or an
// approved application (PUT /applications/:id, a separate code path with
// its own tx.tripParticipant.create). Both used to only backfill this for
// the direct-add path; approval got nothing, despite being the more common
// real-world way someone becomes a participant. Both sub-sends already
// gate on outboundEmail internally (sendMeetingEmail/
// sendRequirementNotificationEmail each call getSettings() themselves), so
// this only needs to own the one cross-cutting exclusion both call sites
// already applied: a backfilled participant doesn't need catch-up
// notifications for things that already happened or never will.
//
// "completed" alone isn't enough to detect that, though -- "closed" covers
// two different real situations that share the same status string: a
// team finalized for a trip that hasn't happened yet (still wants
// catch-up), and a trip entered after the fact purely as a historical
// record (should get none, same as "completed", despite never being
// marked that). Status can't tell those apart; the trip's own dates can --
// so check both signals, not just status, rather than replacing one with
// the other. Shared with sendTripDatesUpdateEmail below, which needs the
// exact same exclusion for the same reason (a historical-record trip
// shouldn't get a "dates changed" email either).
function isTripHistorical(trip) {
  const referenceDate = trip.endDate || trip.startDate;
  const alreadyHappened = referenceDate && new Date(referenceDate) < new Date();
  return trip.status === "completed" || !!alreadyHappened;
}

async function sendLateJoinerCatchUpEmails(trip, participant) {
  if (isTripHistorical(trip)) return;
  const now = new Date();
  const futureMeetings = (trip.meetings || []).filter((m) => !m.cancelledAt && new Date(m.startAt) > now);
  for (const meeting of futureMeetings) {
    await sendMeetingEmail({ ...trip, participants: [participant] }, meeting, "A meeting has been scheduled.");
  }

  const notifiableRequirements = (trip.requirements || []).filter(
    (r) => r.kind === "document" || r.kind === "esignature"
  );
  for (const requirement of notifiableRequirements) {
    await sendRequirementNotificationEmail(trip, requirement, [participant]);
  }
}

// A different gap than the late-joiner one above: an EXISTING participant,
// not a new one. Every participant's welcome email attaches the trip-dates
// .ics at the moment they join (buildTripDatesIcs, same UID-per-trip
// convention as buildMeetingIcs) -- but if an admin later changes
// startDate/endDate, nothing resent that .ics, so every participant who
// already joined kept a calendar entry with the old, now-wrong dates. The
// reused UID means a calendar client updates its existing entry rather
// than creating a duplicate one, exactly as a meeting reschedule's resend
// already relies on for the same reason.
async function sendTripDatesUpdateEmail(trip) {
  if (isTripHistorical(trip) || !trip.startDate || !trip.endDate) return;
  const settings = await getSettings();
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;
  for (const participant of trip.participants || []) {
    await sendParticipantEmail(
      participant,
      `Trip dates updated: ${trip.name || trip.type || "your trip"}`,
      `This trip's dates have changed -- attached is an updated calendar invite.\n\nYour trip page: ${buildTripParticipantAccessUrl(participant)}`,
      {
        attachments: [
          {
            name: "trip-dates.ics",
            content: Buffer.from(buildTripDatesIcs(trip)),
            contentType: "text/calendar",
          },
        ],
      }
    );
  }
}

// participant email with the same .ics attachment shape, just a
// different lead sentence and (for cancel) the CANCEL variant.
async function sendMeetingEmail(trip, meeting, lead, { cancelled = false } = {}) {
  const settings = await getSettings();
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return;
  for (const participant of trip.participants) {
    await sendParticipantEmail(
      participant,
      `${cancelled ? "Meeting cancelled" : "Meeting"}: ${trip.name || trip.type || "your trip"}`,
      buildMeetingEmailBody(meeting, lead, participant, { cancelled }),
      {
        attachments: [
          {
            name: "meeting.ics",
            content: Buffer.from(buildMeetingIcs({ ...meeting, summary: trip.name }, { cancelled })),
            contentType: "text/calendar",
          },
        ],
      }
    );
  }
}

router.post("/:id/meetings", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = meetingInputSchema.required({ startAt: true }).parse(req.body);
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: { participants: true },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });

    const meeting = await prisma.tripMeeting.create({ data: { ...data, tripId: trip.id } });
    await sendMeetingEmail(trip, meeting, "A meeting has been scheduled.");
    res.status(201).json(meeting);
  } catch (err) {
    next(err);
  }
});

// Reschedule-resend: compares incoming startAt/location/meetingLink
// against the row's current stored values before applying the update --
// a change to any of those three counts as a reschedule (a participant
// needs to know the new time, the new place, or that the join link
// changed) and triggers a resend; an agenda-only edit updates silently,
// same precedent this already followed for the field it replaced.
router.put("/meetings/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = meetingInputSchema.parse(req.body);
    const existing = await prisma.tripMeeting.findUnique({
      where: { id: req.params.id },
      include: { trip: { include: { participants: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.cancelledAt) return res.status(400).json({ error: "This meeting has been cancelled." });

    const rescheduled =
      (data.startAt !== undefined &&
        new Date(data.startAt).getTime() !== new Date(existing.startAt).getTime()) ||
      (data.location !== undefined && data.location !== existing.location) ||
      (data.meetingLink !== undefined && data.meetingLink !== existing.meetingLink);

    const updated = await prisma.tripMeeting.update({ where: { id: req.params.id }, data });

    if (rescheduled) {
      await sendMeetingEmail(existing.trip, updated, "Your trip meeting has been updated.");
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Explicit resend -- same invite content as a fresh schedule, for when
// nothing about the meeting changed but an admin still wants to nudge
// participants (a late addition to the team, someone who says they
// never got it) without waiting on, or faking, a reschedule.
router.post("/meetings/:id/resend", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const meeting = await prisma.tripMeeting.findUnique({
      where: { id: req.params.id },
      include: { trip: { include: { participants: true } } },
    });
    if (!meeting) return res.status(404).json({ error: "Not found" });
    if (meeting.cancelledAt) return res.status(400).json({ error: "This meeting has been cancelled." });

    await sendMeetingEmail(meeting.trip, meeting, "Here's a reminder about an upcoming trip meeting.");
    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
});

// Soft-cancel -- see the TripMeeting schema comment for why this isn't a
// delete. Idempotent-ish: cancelling an already-cancelled meeting just
// re-sends the cancellation notice rather than erroring, since an admin
// who clicks it twice (or needs to re-notify a participant who missed
// the first one) shouldn't be blocked.
router.post("/meetings/:id/cancel", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const existing = await prisma.tripMeeting.findUnique({
      where: { id: req.params.id },
      include: { trip: { include: { participants: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const cancelled = await prisma.tripMeeting.update({
      where: { id: req.params.id },
      data: { cancelledAt: existing.cancelledAt || new Date() },
    });
    await sendMeetingEmail(existing.trip, cancelled, "A trip meeting has been cancelled.", {
      cancelled: true,
    });
    res.json(cancelled);
  } catch (err) {
    next(err);
  }
});

// Hard delete -- for correcting a meeting that was created by mistake.
// Refused once a meeting has already been cancelled (which already sent
// its own notice -- deleting on top of that would just be a second,
// redundant state change with nothing left for it to accomplish).
// Deliberately still allowed on a never-cancelled meeting even though
// creating one already sent an invite -- an admin correcting a real
// mistake (wrong trip, duplicate entry) shouldn't be forced through
// "cancel" (which announces a cancellation nobody should see) just to
// remove it; cancel is for calling off a real meeting, not for undoing
// a data-entry error.
router.delete("/meetings/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const existing = await prisma.tripMeeting.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.cancelledAt) {
      return res.status(400).json({ error: "This meeting was already cancelled; nothing left to delete." });
    }
    await prisma.tripMeeting.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Documents ----

router.post(
  "/:tripId/participants/:id/request-documents",
  requireFeature("outboundEmail"),
  requireFeature("inboundEmail"),
  requireRole("admin", "editor"),
  async (req, res, next) => {
    try {
      const { message } = z.object({ message: z.string().min(1) }).parse(req.body);
      const settings = await getSettings();
      if (!settings?.inboundEmailAddress) {
        return res
          .status(400)
          .json({ error: "Set an inbound email address under Site Administration → Email first" });
      }
      const participant = await prisma.tripParticipant.findUnique({ where: { id: req.params.id } });
      if (!participant) return res.status(404).json({ error: "Not found" });

      const result = await sendParticipantEmail(participant, "Document request", message, {
        replyTo: settings.inboundEmailAddress,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/documents",
  requireRole("admin", "editor"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const { participantId, requirementId, title } = req.body;
      const data = {
        tripId: req.params.id,
        participantId: participantId || null,
        requirementId: requirementId || null,
        title: title || null,
        bytes: req.file.buffer,
        fileName: req.file.originalname,
        contentType: req.file.mimetype || "application/octet-stream",
      };
      // Upsert, not a plain create, when both fields are set -- the
      // public self-service upload route (publicTrips.js) relies on the
      // same @@unique([requirementId, participantId]) constraint to make
      // a reupload replace rather than duplicate, and an admin
      // re-uploading a corrected file for the same requirement+
      // participant pair gets the identical "replace" behavior rather
      // than hitting that constraint as an error. Either participantId
      // or requirementId null (a trip-wide document, or one with no
      // tracked requirement) always creates a new row -- the constraint
      // only applies once both are non-null.
      const created =
        participantId && requirementId
          ? await prisma.tripDocument.upsert({
              where: { requirementId_participantId: { requirementId, participantId } },
              create: data,
              update: data,
              omit: { bytes: true },
            })
          : await prisma.tripDocument.create({ data, omit: { bytes: true } });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

// GET /documents/:id/download -- streams the file straight from the
// database, same shared helper/convention as PartnerFile's own
// GET /:id/download (partnerFiles.js). Genuinely missing until now: a
// TripDocument could be uploaded, filed from an inbound email, or logged
// manually, but nothing anywhere could ever read it back -- only
// title/fileName metadata, never the actual bytes.
router.get("/documents/:id/download", async (req, res, next) => {
  try {
    const record = await prisma.tripDocument.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Not found" });
    sendStoredFile(res, record);
  } catch (err) {
    next(err);
  }
});

router.delete("/documents/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    await prisma.tripDocument.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Contributions ----

const contributionSchema = z.object({
  participantId: z.string().optional().nullable(),
  donorName: z.string().min(1),
  donorEmail: z.string().email().optional().nullable(),
  donorPhone: z.string().optional().nullable(),
  amount: z.coerce.number().int().positive(),
  method: z.enum(["check", "cash", "other"]),
  reference: z.string().optional().nullable(),
  receivedDate: z.coerce.date(),
});

router.post("/:id/contributions", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = contributionSchema.parse(req.body);
    const created = await prisma.tripContribution.create({ data: { ...data, tripId: req.params.id } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
