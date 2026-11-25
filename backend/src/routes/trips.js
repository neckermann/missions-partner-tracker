// Trip-level CRUD plus the small sub-resources (budget lines, flight segments, documents,
// contributions). Requirements, applications/participants and meetings live in tripRequirements.js,
// tripParticipants.js and tripMeetings.js, mounted at the same /api/trips prefix.
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { recordAudit } = require("../utils/auditLog");
const { latestOf, tripLastUpdated, listFields } = require("../utils/lastUpdated");
const { withSendingChurch } = require("../utils/sendingChurch");

const {
  requireAuth,
  requireRole,
  requireTripScope,
  allowGuestPartnerList,
} = require("../middleware/requireAuth");
const { isSeatOnly, redactTripForSeat } = require("../utils/seatTripView");
const { requireFeature } = require("../middleware/requireFeature");
const { generateShareToken } = require("../utils/tripAccessToken");
const {
  sendTripDatesUpdateEmail,
  sendLateJoinerCatchUpEmails,
  isTripHistorical,
} = require("../utils/tripEmails");
const { APPLICATION_QUESTION_SCHEMA } = require("../utils/applicationQuestions");
const {
  QUESTION_ORDER,
  ANSWERS_INCLUDE,
  loadRequirementItems,
  replaceQuestions,
  copyTripQuestions,
} = require("../utils/tripTemplates");
const { sendStoredFile } = require("../utils/fileResponse");
const { tripDocumentUpload } = require("../utils/upload");
const { participantSchema, defaultParticipantGoal } = require("../utils/tripParticipantSchema");
const { SOON_DAYS, isRequirementFulfilledForParticipant } = require("../notifications/categories");
const { isContactLogEnabled } = require("../utils/contactLogQueries");
const { readableNeedPartnerIds } = require("../utils/guestAccess");

// Lookups for routes addressed by a child record's own id, not the trip's
// -- requireTripScope needs the owning trip id before it can check it
// against the trips a guest holds an active grant for.
async function tripIdOfBudgetLine(req) {
  const row = await prisma.tripBudgetLine.findUnique({
    where: { id: req.params.id },
    select: { tripId: true },
  });
  return row?.tripId;
}
async function tripIdOfFlightSegment(req) {
  const row = await prisma.tripFlightSegment.findUnique({
    where: { id: req.params.id },
    select: { tripId: true },
  });
  return row?.tripId;
}
async function tripIdOfDocument(req) {
  const row = await prisma.tripDocument.findUnique({
    where: { id: req.params.id },
    select: { tripId: true },
  });
  return row?.tripId;
}

const router = express.Router();
router.use(requireAuth);
// Gates the whole resource: this router is the only writer for Trip/TripParticipant and the sibling
// models below.
router.use(requireFeature("trips"));

// Shared with the public self-service upload route (publicTrips.js) --
// same allowlist/size cap, one place to change either (backend/src/utils/upload.js).
const upload = tripDocumentUpload();

// Only needed by POST /:id/generate-application-link below: a narrow select, not a full settings fetch.
async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { allowPrivateApplicationLinks: true },
  });
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
  // Participant photo bytes live in their own table; the admin UI renders one via
  // GET /public/trips/participants/:id/photo.
  participants: true,
  // Also on the plain list route: the Unmatched Emails queue flattens every trip's participants into one
  // picker and needs each trip's requirements. requirementStatuses carries per-participant
  // completedAt/reminderSentAt, needed wherever a task's fulfillment is shown; documents lets the list
  // reuse the notification registry's isRequirementFulfilledForParticipant instead of a second
  // reimplementation that could drift.
  requirements: { include: { requirementStatuses: true, documents: true } },
  // This trip's own application questions, in the admin's order.
  applicationQuestions: QUESTION_ORDER,
  // Pending-only, as GET /:id applies to this relation; the list route needs it for the per-row "has a
  // pending application" badge (annotateTripFlags).
  applications: { where: { status: "pending" }, select: { id: true, tripId: true, createdAt: true } },
  // The amount-only projection the "Raised" column in AdminTrips.jsx needs.
  contributions: { select: { amount: true } },
  budgetLines: true,
  flightSegments: {
    orderBy: { departureAt: "asc" },
    include: { participants: { select: { id: true, firstName: true, lastName: true } } },
  },
};

// Per-row indicators for the plain trip list (AdminTrips.jsx), reusing the notification registry's
// rules so a flagged trip is the one that category would surface. Needed because a category's linkTo
// can point at one trip only when exactly one is responsible (categories.js); otherwise it falls
// back to this list.
function annotateTripFlags(trip) {
  const now = new Date();
  const soonBy = new Date(now.getTime() + SOON_DAYS * 24 * 60 * 60 * 1000);
  const departingSoon =
    trip.status !== "completed" &&
    trip.startDate &&
    new Date(trip.startDate) > now &&
    new Date(trip.startDate) <= soonBy;
  const hasIncompleteRequirement = trip.requirements.some((req) =>
    trip.participants.some(
      (participant) => !isRequirementFulfilledForParticipant(req, participant.id, req.documents)
    )
  );
  const hasOverdueRequirement = trip.requirements.some(
    (req) =>
      req.dueAt &&
      new Date(req.dueAt) < now &&
      trip.participants.some(
        (participant) => !isRequirementFulfilledForParticipant(req, participant.id, req.documents)
      )
  );
  return {
    ...trip,
    hasPendingApplications: (trip.applications || []).length > 0,
    hasOverdueRequirement,
    departingSoonIncomplete: departingSoon && hasIncompleteRequirement,
  };
}

// GET /api/trips?partnerId=&type=&year= -- admin/editor/viewer read the full cross-trip list. A Trip
// Leader calls it with ?partnerId= from Partner Detail's "Mission Trips" section for their one
// partner, so it uses the partner-scoped check, not an outright role block (which would 403 that).
router.get("/", allowGuestPartnerList, async (req, res, next) => {
  try {
    const query = tripQuerySchema.parse(req.query);
    const where = {};
    // #327 Finding 2: requirePartnerQueryScope only confirms ?partnerId= matches the caller's trip's
    // partner, but a partner can have several trips, and their full rosters (DOB, guardian/emergency
    // contacts) would leak. Scope to exactly the trips they hold a grant for (#356), then narrow by
    // partnerId.
    if (req.user.role === "guest") {
      where.id = { in: req.user.tripIds };
    }
    if (query.partnerId) {
      where.partnerId = query.partnerId;
    }
    if (query.type) where.type = query.type;
    withSendingChurch(where, req.query.sendingChurch);
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
    // When each trip (or any part of it: team, meetings, requirements, money) was
    // last changed -- staff only; a guest's list carries no editor names.
    const updated = req.user.role === "guest" ? null : await tripLastUpdated(records.map((r) => r.id));
    res.json(
      records.map((r) => {
        const row = { ...annotateTripFlags(r), ...(updated ? listFields(updated.get(r.id)) : {}) };
        return isSeatOnly(req.user, r.id) ? redactTripForSeat(row) : row;
      })
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/trips/planning -- §3. Blends open/committed/fallback rows per partner with trip capacity
// fields. Admin/editor/viewer only, as GET / above.
router.get("/planning", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const partners = await prisma.partner.findMany({
      where: { archived: false, tripTypes: { some: {} } },
      select: {
        id: true,
        displayName: true,
        isRestricted: true,
        tripTeamSizeMin: true,
        tripTeamSizeMax: true,
        tripTypes: { select: { type: true } },
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
        tripTypesSupported: p.tripTypes.map((t) => t.type),
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

router.get("/:id", requireTripScope("id"), async (req, res, next) => {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      include: {
        ...tripInclude,
        // Only on this single-trip route, not the list route that shares tripInclude: the approved applicant's
        // custom-question answers would otherwise be stranded once approval turns a TripApplication into a
        // TripParticipant (`applications` below holds only pending rows).
        participants: {
          ...tripInclude.participants,
          include: { application: { select: { answers: ANSWERS_INCLUDE, createdAt: true } } },
        },
        applications: { where: { status: "pending" } },
        // rsvps included for the Meetings tally and per-participant breakdown.
        meetings: { include: { rsvps: true } },
        // Explicit select, not `documents: true`, which pulled every document's raw `bytes`/`signatureImage`
        // into this response; a real uploaded photo (a few MB, base64-inflated) made the route time out.
        // The admin UI reads only id/title/fileName/participantId/requirementId and fetches bytes via
        // GET /documents/:id/download.
        documents: {
          select: {
            id: true,
            tripId: true,
            participantId: true,
            requirementId: true,
            title: true,
            fileName: true,
            fileSize: true,
            contentType: true,
            createdAt: true,
            signerName: true,
            signerRelationship: true,
            attestedAt: true,
          },
        },
        contributions: true,
      },
    });
    if (!trip) return res.status(404).json({ error: "Not found" });
    // "Last edited" on the trip page covers its team, meetings, requirements and money too.
    const shown = latestOf([
      { at: trip.lastEditedAt, name: trip.lastEditedByName },
      (await tripLastUpdated([trip.id])).get(trip.id),
    ]);
    if (shown) {
      trip.lastEditedAt = shown.at;
      trip.lastEditedByName = shown.name;
    }
    // The one trip setting a guest's page needs (it shows the Financial tab). They can't read
    // GET /api/settings/trips (giving instructions, templates, libraries), so it rides here.
    const tripSettings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enableTripBudgeting: true },
    });
    trip.enableTripBudgeting = tripSettings?.enableTripBudgeting === true;
    // A care team seat sees names and dates only (#409).
    res.json(isSeatOnly(req.user, trip.id) ? redactTripForSeat(trip) : trip);
  } catch (err) {
    next(err);
  }
});

// POST /api/trips  (create — editor or admin)
//
// Copies ChurchSettings.tripRequirementTemplate onto a new trip unless it is a historical backfill
// (status === "completed": nothing left to fulfill). A one-time snapshot, not a live link (see
// tripRequirementTemplate in schema.prisma).
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, applicationQuestions, ...data } = tripSchema
      .refine(datesInOrder, DATE_ORDER_ISSUE)
      .refine(albumLinkValid, ALBUM_LINK_ISSUE)
      .parse(req.body);

    let requirementTemplate = [];
    // The Trip model's `status` default is "completed", so an omitted status must not get the template
    // either.
    if (data.status && data.status !== "completed") {
      requirementTemplate = await loadRequirementItems("template");
    }

    const made = await prisma.trip.create({
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
                minorsOnly: r.minorsOnly || false,
              })),
            }
          : undefined,
      },
      include: tripInclude,
    });
    // The trip's application questions are rows of their own.
    if (applicationQuestions?.length) await replaceQuestions(prisma, "trip", made.id, applicationQuestions);
    const created = applicationQuestions?.length
      ? await prisma.trip.findUnique({ where: { id: made.id }, include: tripInclude })
      : made;

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put(
  "/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const { participants, applicationQuestions, ...data } = tripSchema
        .partial()
        .refine(datesInOrder, DATE_ORDER_ISSUE)
        .refine(albumLinkValid, ALBUM_LINK_ISSUE)
        .parse(req.body);

      // #327 Finding 2: a Trip Leader must not re-point their trip's partnerId: requirePartnerQueryScope and
      // the trip's linked-Partner read trust it to authorize partner-scoped reads, and SPEC.md § 5.1 says
      // this role never touches the Partner.
      if (req.user.role === "guest" && data.partnerId !== undefined) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const existing = await prisma.trip.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "Not found" });

      // The goal in effect after this update: this call's value, else the trip's existing one.
      const effectiveGoal =
        data.supportRaisingGoal !== undefined ? data.supportRaisingGoal : existing.supportRaisingGoal;

      // "Did this change" check, as PUT /meetings/:id's reschedule-resend: only startDate/endDate count,
      // and only when the incoming value differs (datesChanged treats unchanged or absent alike: no resend).
      function dateChanged(incoming, current) {
        if (incoming === undefined) return false;
        const incomingTime = incoming ? new Date(incoming).getTime() : null;
        const currentTime = current ? new Date(current).getTime() : null;
        return incomingTime !== currentTime;
      }
      const datesChanged =
        dateChanged(data.startDate, existing.startDate) || dateChanged(data.endDate, existing.endDate);

      const updated = await prisma.$transaction(async (tx) => {
        if (participants !== undefined) {
          await tx.tripParticipant.deleteMany({ where: { tripId: req.params.id, applicationId: null } });
        }
        if (applicationQuestions !== undefined) {
          await replaceQuestions(tx, "trip", req.params.id, applicationQuestions || []);
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

      let datesUpdateEmail = null;
      if (datesChanged) {
        datesUpdateEmail = await sendTripDatesUpdateEmail(updated);

        // #310: setting dates (even the first time) is the first moment to re-check whether anyone on the
        // roster is owed a catch-up for a meeting/requirement that did not exist when they joined (join-time
        // catch-up runs once). `since: participant.createdAt` keeps already-sent content from being re-sent.
        // tripInclude carries no meetings, so they are fetched narrowly here.
        if (!isTripHistorical(updated) && (updated.participants || []).length > 0) {
          const meetings = await prisma.tripMeeting.findMany({ where: { tripId: req.params.id } });
          for (const participant of updated.participants) {
            await sendLateJoinerCatchUpEmails({ ...updated, meetings }, participant, {
              since: participant.createdAt,
            });
          }
        }
      }

      res.json({ ...updated, datesUpdateEmail });
    } catch (err) {
      next(err);
    }
  }
);

// The Wrap up trip wizard (#358): finishes a trip in one step (actual dates, optional plain-text
// debrief answers, album link and, when the contact log is on and the person may use it, a partner
// contact with an optional follow-up date) and sets it to "completed". Open to admin, editor and a
// trip leader for their own trip (requireTripScope). Nothing is emailed. Re-running edits the debrief;
// the first wrap-up time is kept.
const wrapUpText = z.string().trim().max(5000).optional().nullable();
const wrapUpSchema = z
  .object({
    startDate: z.coerce.date().optional().nullable(),
    endDate: z.coerce.date().optional().nullable(),
    debrief: z
      .object({
        whatWeDid: wrapUpText,
        wentWell: wrapUpText,
        wasHard: wrapUpText,
        partnerNeeds: wrapUpText,
      })
      .optional(),
    albumProvider: z.enum(["google_photos", "icloud", "other"]).optional().nullable(),
    albumUrl: z.string().optional().nullable(),
    followUp: z
      .object({
        logContact: z.boolean(),
        followUpDate: z.coerce.date().optional().nullable(),
      })
      .optional(),
  })
  .refine(datesInOrder, DATE_ORDER_ISSUE)
  .refine(albumLinkValid, ALBUM_LINK_ISSUE);

const DEBRIEF_COLUMNS = {
  whatWeDid: "debriefWhatWeDid",
  wentWell: "debriefWentWell",
  wasHard: "debriefWasHard",
  partnerNeeds: "debriefPartnerNeeds",
};

router.post(
  "/:id/wrap-up",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const body = wrapUpSchema.parse(req.body);
      const existing = await prisma.trip.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: "Not found" });

      const startDate = body.startDate !== undefined ? body.startDate : existing.startDate;
      const endDate = body.endDate !== undefined ? body.endDate : existing.endDate;
      if (startDate && endDate && endDate < startDate) {
        return res.status(400).json({ error: "endDate cannot be before startDate" });
      }

      const debrief = {};
      for (const [key, column] of Object.entries(DEBRIEF_COLUMNS)) {
        if (body.debrief && body.debrief[key] !== undefined) debrief[column] = body.debrief[key] || null;
      }

      // The partner contact: only when asked for, the contact log is on, this trip has a partner,
      // and the person may use the log for that partner (staff, or a guest on its care team; a
      // trip leader with a trip grant alone never reaches the contact log).
      let contactLogged = false;
      const reach = readableNeedPartnerIds(req.user);
      const mayLog = existing.partnerId && (reach === null || reach.includes(existing.partnerId));
      const wantsContact = body.followUp?.logContact === true;

      const updated = await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.update({
          where: { id: existing.id },
          data: {
            status: "completed",
            wrappedUpAt: existing.wrappedUpAt ?? new Date(),
            ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
            ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
            ...(body.albumProvider !== undefined ? { albumProvider: body.albumProvider } : {}),
            ...(body.albumUrl !== undefined ? { albumUrl: body.albumUrl } : {}),
            ...debrief,
          },
          include: tripInclude,
        });
        if (wantsContact && mayLog && (await isContactLogEnabled())) {
          const day = endDate ? new Date(endDate) : new Date();
          await tx.contactLog.create({
            data: {
              partnerId: existing.partnerId,
              contactType: "visit",
              direction: "outbound",
              topics: ["trip"],
              contactDate: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())),
              notes: `Trip wrapped up${existing.name ? `: ${existing.name}` : ""}.`,
              followUpDate: body.followUp.followUpDate || null,
              contactedById: req.user.id,
              createdById: req.user.id,
            },
          });
          contactLogged = true;
        }
        return trip;
      });
      res.json({ trip: updated, contactLogged });
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const existing = await prisma.trip.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    await prisma.$transaction(async (tx) => {
      await tx.trip.delete({ where: { id: req.params.id } });
      await recordAudit(tx, {
        action: "trip.deleted",
        actor: req.user,
        entity: { type: "trip", id: existing.id, label: existing.name },
        req,
      });
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/trips/:id/clone -- §11. Copies reusable shape only, never participants/applications/
// meetings/documents/contributions. Not gated beyond requireFeature("trips") + requireRole.
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
        status: "planning",
        // label/kind/bodyText/reminderLeadDays copy forward (a repeat trip wants the same checklist and
        // agreement text); dueAt does NOT, since a prior run's calendar date is never right (like startDate/
        // endDate).
        requirements: {
          create: source.requirements.map((r) => ({
            label: r.label,
            kind: r.kind,
            bodyText: r.bodyText,
            reminderLeadDays: r.reminderLeadDays,
            minorsOnly: r.minorsOnly,
          })),
        },
      },
      include: tripInclude,
    });
    await copyTripQuestions(prisma, source.id, cloned.id);
    res.status(201).json(await prisma.trip.findUnique({ where: { id: cloned.id }, include: tripInclude }));
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

// Budget lines: planned, trip-wide, estimate-only (no actualAmount; see TripBudgetLine in schema.prisma).

const budgetLineSchema = z.object({
  label: z.string().min(1),
  estimatedAmount: z.coerce.number().int(),
});

router.post(
  "/:id/budget-lines",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const data = budgetLineSchema.parse(req.body);
      const created = await prisma.tripBudgetLine.create({ data: { tripId: req.params.id, ...data } });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/budget-lines/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfBudgetLine),
  async (req, res, next) => {
    try {
      const data = budgetLineSchema.partial().parse(req.body);
      const updated = await prisma.tripBudgetLine.update({ where: { id: req.params.id }, data });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/budget-lines/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfBudgetLine),
  async (req, res, next) => {
    try {
      await prisma.tripBudgetLine.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// Flight segments: same CRUD shape as budget lines, plus participantIds (#265), a real relation.
// Omitted or empty means the whole team; the self-service page (publicTrips.js) filters on it, the
// admin view never does.
const flightSegmentSchema = z.object({
  participantIds: z.array(z.string()).optional(),
  airline: z.string().optional().nullable(),
  flightNumber: z.string().optional().nullable(),
  departureAirport: z.string().optional().nullable(),
  departureAt: z.coerce.date().optional().nullable(),
  arrivalAirport: z.string().optional().nullable(),
  arrivalAt: z.coerce.date().optional().nullable(),
});

// Every id must belong to this trip (#412). Without it, a guest on one trip who knew another trip's
// participant or requirement ids could attach, overwrite or read that trip's records.
async function idsOutsideTrip(tripId, { participantIds = [], requirementId } = {}) {
  const participants = [...new Set(participantIds.filter(Boolean))];
  if (participants.length) {
    const found = await prisma.tripParticipant.count({ where: { tripId, id: { in: participants } } });
    if (found !== participants.length) return "One or more people aren't on this trip";
  }
  if (requirementId) {
    const found = await prisma.tripRequirement.count({ where: { tripId, id: requirementId } });
    if (!found) return "That requirement isn't on this trip";
  }
  return null;
}

router.post(
  "/:id/flight-segments",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const { participantIds, ...data } = flightSegmentSchema.parse(req.body);
      const outside = await idsOutsideTrip(req.params.id, { participantIds });
      if (outside) return res.status(400).json({ error: outside });
      const created = await prisma.tripFlightSegment.create({
        data: {
          tripId: req.params.id,
          ...data,
          participants: participantIds?.length
            ? { connect: participantIds.map((id) => ({ id })) }
            : undefined,
        },
        include: { participants: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/flight-segments/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfFlightSegment),
  async (req, res, next) => {
    try {
      const { participantIds, ...data } = flightSegmentSchema.partial().parse(req.body);
      const segment = await prisma.tripFlightSegment.findUnique({
        where: { id: req.params.id },
        select: { tripId: true },
      });
      const outside = await idsOutsideTrip(segment?.tripId, { participantIds });
      if (outside) return res.status(400).json({ error: outside });
      const updated = await prisma.tripFlightSegment.update({
        where: { id: req.params.id },
        data: {
          ...data,
          // `set` replaces the whole relation: the admin UI always sends the complete list.
          participants:
            participantIds !== undefined ? { set: participantIds.map((id) => ({ id })) } : undefined,
        },
        include: { participants: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/flight-segments/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfFlightSegment),
  async (req, res, next) => {
    try {
      await prisma.tripFlightSegment.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// Documents (file storage); the "request documents" email route is in tripParticipants.js.

router.post(
  "/:id/documents",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const { participantId, requirementId, title } = req.body;
      const outside = await idsOutsideTrip(req.params.id, {
        participantIds: participantId ? [participantId] : [],
        requirementId,
      });
      if (outside) return res.status(400).json({ error: outside });
      const bytes = req.file.buffer;
      const meta = {
        tripId: req.params.id,
        participantId: participantId || null,
        requirementId: requirementId || null,
        title: title || null,
        fileName: req.file.originalname,
        contentType: req.file.mimetype || "application/octet-stream",
        fileSize: req.file.size,
      };
      // Upsert when both fields are set: the public self-service upload relies on the same
      // @@unique([requirementId, participantId]) so a re-upload replaces rather than duplicates, and an
      // admin re-uploading gets the same behavior. A null participantId or requirementId (trip-wide or
      // untracked) always creates a new row. Bytes live in their own table (bytesRow); the nested upsert
      // on update replaces them in place.
      const created =
        participantId && requirementId
          ? await prisma.tripDocument.upsert({
              where: { requirementId_participantId: { requirementId, participantId } },
              create: { ...meta, bytesRow: { create: { bytes } } },
              update: { ...meta, bytesRow: { upsert: { create: { bytes }, update: { bytes } } } },
            })
          : await prisma.tripDocument.create({ data: { ...meta, bytesRow: { create: { bytes } } } });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

// GET /documents/:id/download -- streams the file from the database, same helper as PartnerFile's
// GET /:id/download (partnerFiles.js).
router.get("/documents/:id/download", requireTripScope(tripIdOfDocument), async (req, res, next) => {
  try {
    const record = await prisma.tripDocument.findUnique({
      where: { id: req.params.id },
      include: { bytesRow: { select: { bytes: true } } },
    });
    if (!record?.bytesRow) return res.status(404).json({ error: "Not found" });
    // Passports, waivers and the like are for the trip's own team and staff, not a care team seat (#409).
    if (isSeatOnly(req.user, record.tripId))
      return res.status(403).json({ error: "Insufficient permissions" });
    sendStoredFile(res, { ...record, bytes: record.bytesRow.bytes });
  } catch (err) {
    next(err);
  }
});

router.delete(
  "/documents/:id",
  requireRole("admin", "editor", "guest"),
  requireTripScope(tripIdOfDocument),
  async (req, res, next) => {
    try {
      await prisma.tripDocument.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

const contributionSchema = z.object({
  participantId: z.string().optional().nullable(),
  donorName: z.string().min(1),
  donorEmail: z.string().email().optional().nullable(),
  donorPhone: z.string().optional().nullable(),
  amount: z.coerce.number().int().positive(),
  method: z.enum(["check", "cash", "online", "other"]),
  reference: z.string().optional().nullable(),
  receivedDate: z.coerce.date(),
});

router.post(
  "/:id/contributions",
  requireRole("admin", "editor", "guest"),
  requireTripScope("id"),
  async (req, res, next) => {
    try {
      const data = contributionSchema.parse(req.body);
      const outside = await idsOutsideTrip(req.params.id, {
        participantIds: data.participantId ? [data.participantId] : [],
      });
      if (outside) return res.status(400).json({ error: outside });
      const created = await prisma.tripContribution.create({ data: { ...data, tripId: req.params.id } });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
