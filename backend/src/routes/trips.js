// #271 Finding 1: Requirements (tripRequirements.js), Applications/
// Participants (tripParticipants.js), and Meetings (tripMeetings.js)
// split out into their own sub-resource routers, all mounted at the
// same /api/trips prefix (server.js). This file keeps trip-level CRUD
// plus the smaller sub-resources that don't yet justify their own file
// (budget lines, flight segments, documents, contributions).
const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { generateShareToken } = require("../utils/tripAccessToken");
const { sendTripDatesUpdateEmail } = require("../utils/tripEmails");
const { APPLICATION_QUESTION_SCHEMA } = require("../utils/applicationQuestions");
const { sendStoredFile } = require("../utils/fileResponse");
const { tripDocumentUpload } = require("../utils/upload");
const { participantSchema, defaultParticipantGoal } = require("../utils/tripParticipantSchema");

const router = express.Router();
router.use(requireAuth); // everything below requires a logged-in user
// Gates the whole resource -- this router is the only writer for
// Trip/TripParticipant and every sibling model below.
router.use(requireFeature("trips"));

// Shared with the public self-service upload route (publicTrips.js) --
// same allowlist/size cap, one place to change either (backend/src/utils/upload.js).
const upload = tripDocumentUpload();

// Only ever needed by POST /:id/generate-application-link below --
// narrower than a full settings fetch, same narrow-select discipline
// the rest of this app already follows.
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
        // Explicit select, not `documents: true` -- that pulled every
        // document's raw `bytes` (and `signatureImage`) inline into this
        // response. Harmless with seed data's small PDFs, but a real
        // uploaded photo (a few MB, base64-inflated ~33% larger in JSON)
        // made this route slow enough to intermittently time out --
        // reproduced directly against dev-demo. The admin UI only ever
        // reads id/title/fileName/participantId/requirementId from this
        // list (AdminTripDetail.jsx) and fetches actual bytes on demand
        // via the separate GET /documents/:id/download route -- nothing
        // here needs the content inline.
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
    const effectiveGoal =
      data.supportRaisingGoal !== undefined ? data.supportRaisingGoal : existing.supportRaisingGoal;

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
    const datesChanged =
      dateChanged(data.startDate, existing.startDate) || dateChanged(data.endDate, existing.endDate);

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
        participants:
          participantIds !== undefined ? { set: participantIds.map((id) => ({ id })) } : undefined,
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

// ---- Documents (file storage -- see tripParticipants.js for the
// separate "request documents from a participant" email route) ----

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
        fileSize: req.file.size,
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
  method: z.enum(["check", "cash", "online", "other"]),
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
