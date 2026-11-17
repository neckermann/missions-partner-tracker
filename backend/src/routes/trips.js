const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { generateShareToken, buildTripParticipantAccessUrl, appBaseUrl } = require("../utils/tripAccessToken");
const { sendParticipantEmail, buildMeetingIcs, buildTripDatesIcs } = require("../utils/tripEmails");
const { isFeatureEnabled } = require("../utils/features");
const { APPLICATION_QUESTION_SCHEMA } = require("../utils/applicationQuestions");
const { sendStoredFile } = require("../utils/fileResponse");
const { decodePhotoDataUrl } = require("../utils/participantPhoto");
const multer = require("multer");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Gates the whole resource -- this router is the only writer for
// Trip/TripParticipant and every sibling model below.
router.use(requireFeature("trips"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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
});

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
  flightSegments: { orderBy: { departureAt: "asc" } },
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
        meetings: true,
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
        participants: participants?.length ? { create: participants } : undefined,
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

    const updated = await prisma.$transaction(async (tx) => {
      if (participants !== undefined) {
        await tx.tripParticipant.deleteMany({ where: { tripId: req.params.id, applicationId: null } });
      }
      return tx.trip.update({
        where: { id: req.params.id },
        data: { ...data, participants: participants !== undefined ? { create: participants } : undefined },
        include: tripInclude,
      });
    });
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
// field. Same CRUD shape as budget lines above.
const flightSegmentSchema = z.object({
  label: z.string().optional().nullable(),
  airline: z.string().optional().nullable(),
  flightNumber: z.string().optional().nullable(),
  departureAirport: z.string().optional().nullable(),
  departureAt: z.coerce.date().optional().nullable(),
  arrivalAirport: z.string().optional().nullable(),
  arrivalAt: z.coerce.date().optional().nullable(),
});

router.post("/:id/flight-segments", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = flightSegmentSchema.parse(req.body);
    const created = await prisma.tripFlightSegment.create({ data: { tripId: req.params.id, ...data } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/flight-segments/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = flightSegmentSchema.partial().parse(req.body);
    const updated = await prisma.tripFlightSegment.update({ where: { id: req.params.id }, data });
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
// the trip-dates roster invite (§9) once, only for a non-completed trip.
router.put("/applications/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { status, declinedReason } = z
      .object({
        status: z.enum(["approved", "declined", "pending"]),
        declinedReason: z.string().optional().nullable(),
      })
      .parse(req.body);
    const application = await prisma.tripApplication.findUnique({
      where: { id: req.params.id },
      include: { trip: true },
    });
    if (!application) return res.status(404).json({ error: "Not found" });

    // Fetched once, before the transaction -- decides both whether this
    // new participant gets a support-raising shareToken at all (below)
    // and whether the roster-invite email fires (after the transaction).
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
            // Auto-generated here, not left for a later manual admin
            // click -- the church-wide setting already answers "do we do
            // this at all," so a second per-participant step is pure
            // friction. See the roster-invite email below, which is the
            // one place this new link actually reaches the participant.
            shareToken: settings?.allowPublicSupportRaisingLinks ? generateShareToken() : null,
          },
        });
        return { app, participant };
      }
      return { app, participant: null };
    });

    // Trip-dates roster invite (§9) -- fires once, outside the
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
          `You're on the roster: ${application.trip.name || application.trip.type || "your trip"}`,
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

    res.json(updated.app);
  } catch (err) {
    next(err);
  }
});

// ---- Roster: direct admin add ----

router.post("/:id/participants", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = participantSchema
      .extend({ email: z.string().email().optional().nullable() })
      .parse(req.body);
    const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
    if (!trip) return res.status(404).json({ error: "Not found" });

    const settings = await getSettings();
    const participant = await prisma.tripParticipant.create({
      data: {
        ...data,
        tripId: trip.id,
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
          `You're on the roster: ${trip.name || trip.type || "your trip"}`,
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

router.post("/:id/meetings", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = z
      .object({
        startAt: z.coerce.date(),
        location: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: { participants: true },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });

    const meeting = await prisma.tripMeeting.create({ data: { ...data, tripId: trip.id } });

    const settings = await getSettings();
    if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
      for (const participant of trip.participants) {
        await sendParticipantEmail(
          participant,
          `Meeting scheduled: ${trip.name || trip.type || "your trip"}`,
          `A meeting has been scheduled${meeting.location ? ` at ${meeting.location}` : ""}.`,
          {
            attachments: [
              {
                name: "meeting.ics",
                content: Buffer.from(buildMeetingIcs({ ...meeting, summary: trip.name })),
                contentType: "text/calendar",
              },
            ],
          }
        );
      }
    }
    res.status(201).json(meeting);
  } catch (err) {
    next(err);
  }
});

// Reschedule-resend: compares incoming startAt/location against the
// row's current stored values before applying the update -- a change to
// either counts as a reschedule and triggers a resend; a notes-only edit
// updates silently.
router.put("/meetings/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = z
      .object({
        startAt: z.coerce.date().optional(),
        location: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);
    const existing = await prisma.tripMeeting.findUnique({
      where: { id: req.params.id },
      include: { trip: { include: { participants: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const rescheduled =
      (data.startAt !== undefined &&
        new Date(data.startAt).getTime() !== new Date(existing.startAt).getTime()) ||
      (data.location !== undefined && data.location !== existing.location);

    const updated = await prisma.tripMeeting.update({ where: { id: req.params.id }, data });

    if (rescheduled) {
      const settings = await getSettings();
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        for (const participant of existing.trip.participants) {
          await sendParticipantEmail(
            participant,
            `Meeting moved: ${existing.trip.name || existing.trip.type || "your trip"}`,
            `Your trip meeting has been moved to a new time${updated.location ? ` (${updated.location})` : ""}.`,
            {
              attachments: [
                {
                  name: "meeting.ics",
                  content: Buffer.from(buildMeetingIcs({ ...updated, summary: existing.trip.name })),
                  contentType: "text/calendar",
                },
              ],
            }
          );
        }
      }
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/meetings/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
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
      const created = await prisma.tripDocument.create({
        data: {
          tripId: req.params.id,
          participantId: participantId || null,
          requirementId: requirementId || null,
          title: title || null,
          bytes: req.file.buffer,
          fileName: req.file.originalname,
          contentType: req.file.mimetype || "application/octet-stream",
        },
        omit: { bytes: true },
      });
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
