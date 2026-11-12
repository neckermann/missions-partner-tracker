const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { generateShareToken, buildTripParticipantAccessUrl } = require("../utils/tripAccessToken");
const { sendParticipantEmail, buildMeetingIcs, buildTripDatesIcs } = require("../utils/tripEmails");
const { isFeatureEnabled } = require("../utils/features");
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

const APPLICATION_QUESTION_SCHEMA = z.array(
  z.object({ id: z.string(), label: z.string().min(1), required: z.boolean().optional() })
);

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
  flightDetails: z.string().optional().nullable(),
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
const ALBUM_LINK_ISSUE = { message: "Enter a valid album link for the selected provider", path: ["albumUrl"] };

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
  participants: true,
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
    const records = await prisma.trip.findMany({ where, include: tripInclude, orderBy: { startDate: "desc" } });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/trips/dashboard -- §12. Every trip currently
// planning/accepting_applications/closed (excludes completed), sorted
// soonest-departing first.
router.get("/dashboard", async (req, res, next) => {
  try {
    const trips = await prisma.trip.findMany({
      where: { status: { in: ["planning", "accepting_applications", "closed"] } },
      include: {
        partner: tripPartnerInclude,
        participants: true,
        contributions: { select: { amount: true } },
      },
      orderBy: { startDate: "asc" },
    });
    res.json(
      trips.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        status: t.status,
        startDate: t.startDate,
        endDate: t.endDate,
        partner: t.partner,
        teamFilled: t.participants.length,
        teamSizeMax: t.teamSizeMax ?? null,
        raised: t.contributions.reduce((sum, c) => sum + c.amount, 0),
        supportRaisingGoal: t.supportRaisingGoal,
      }))
    );
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
          select: { id: true, status: true, startDate: true, endDate: true, teamSizeMax: true, participants: true },
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
        applications: { where: { status: "pending" } },
        meetings: true,
        documents: true,
        documentRequirements: true,
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
router.post("/", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { participants, ...data } = tripSchema
      .refine(datesInOrder, DATE_ORDER_ISSUE)
      .refine(albumLinkValid, ALBUM_LINK_ISSUE)
      .parse(req.body);
    const created = await prisma.trip.create({
      data: { ...data, participants: participants?.length ? { create: participants } : undefined },
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
      include: { documentRequirements: true },
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
        documentRequirements: {
          create: source.documentRequirements.map((r) => ({ label: r.label })),
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
      return res.status(400).json({ error: "Private application links are turned off -- enable them in Trip settings first" });
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

// ---- Document requirements ----

router.post("/:id/document-requirements", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { label } = z.object({ label: z.string().min(1) }).parse(req.body);
    const created = await prisma.tripDocumentRequirement.create({ data: { tripId: req.params.id, label } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.delete("/document-requirements/:id", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    await prisma.tripDocumentRequirement.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

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
    const { status } = z.object({ status: z.enum(["approved", "declined"]) }).parse(req.body);
    const application = await prisma.tripApplication.findUnique({
      where: { id: req.params.id },
      include: { trip: true },
    });
    if (!application) return res.status(404).json({ error: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const app = await tx.tripApplication.update({
        where: { id: req.params.id },
        data: { status, reviewedAt: new Date(), reviewedById: req.user.id },
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
          },
        });
        return { app, participant };
      }
      return { app, participant: null };
    });

    // Trip-dates roster invite (§9) -- fires once, outside the
    // transaction (an email failure shouldn't roll back the approval).
    if (updated.participant && application.trip.status !== "completed" && application.trip.startDate && application.trip.endDate) {
      const settings = await getSettings();
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        await sendParticipantEmail(
          updated.participant,
          `You're on the roster: ${application.trip.name || application.trip.type || "your trip"}`,
          "You've been approved for the trip -- attached is a calendar invite for the trip dates.",
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
    const data = participantSchema.extend({ email: z.string().email().optional().nullable() }).parse(req.body);
    const trip = await prisma.trip.findUnique({ where: { id: req.params.id } });
    if (!trip) return res.status(404).json({ error: "Not found" });

    const participant = await prisma.tripParticipant.create({ data: { ...data, tripId: trip.id } });

    if (trip.status !== "completed" && trip.startDate && trip.endDate) {
      const settings = await getSettings();
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        await sendParticipantEmail(
          participant,
          `You're on the roster: ${trip.name || trip.type || "your trip"}`,
          "Attached is a calendar invite for the trip dates.",
          {
            attachments: [
              { name: "trip-dates.ics", content: Buffer.from(buildTripDatesIcs(trip)), contentType: "text/calendar" },
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

// POST /api/trips/participants/:id/generate-support-raising-link
router.post("/participants/:id/generate-support-raising-link", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.allowPublicSupportRaisingLinks) {
      return res.status(400).json({ error: "Public support-raising links are turned off -- enable them in Trip settings first" });
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
});

// POST /api/trips/participants/:id/request-access-link -- admin-triggered
// resend of a participant's own self-service link (distinct from the
// public, self-triggered §4a lost-link flow).
router.post("/participants/:id/request-access-link", requireRole("admin", "editor"), async (req, res, next) => {
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
});

// ---- Meetings ----

router.post("/:id/meetings", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const data = z
      .object({ startAt: z.coerce.date(), location: z.string().optional().nullable(), notes: z.string().optional().nullable() })
      .parse(req.body);
    const trip = await prisma.trip.findUnique({ where: { id: req.params.id }, include: { participants: true } });
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
      .object({ startAt: z.coerce.date().optional(), location: z.string().optional().nullable(), notes: z.string().optional().nullable() })
      .parse(req.body);
    const existing = await prisma.tripMeeting.findUnique({
      where: { id: req.params.id },
      include: { trip: { include: { participants: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const rescheduled =
      (data.startAt !== undefined && new Date(data.startAt).getTime() !== new Date(existing.startAt).getTime()) ||
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
        return res.status(400).json({ error: "Set an inbound email address under Site Administration → Email first" });
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

router.post("/:id/documents", requireRole("admin", "editor"), upload.single("file"), async (req, res, next) => {
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
