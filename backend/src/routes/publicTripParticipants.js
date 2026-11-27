// Public, unauthenticated participant surfaces for Trips (#252): support-raising page
// (shareToken), self-service page (signed access token), e-signature/document upload, photo,
// meeting RSVP/ICS and lost-link recovery. Mounted at /api/public/trip-participants and
// /api/public/trips/meetings from server.js.
//
// The signed-token self-service routes are never blocked or masked for a restricted partner (the
// reader is the one going). GET /participants/by-token/:shareToken MASKS a restricted partner
// instead, since reaching it requires a secret only staff chose to share.
const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../prismaClient");
const { requireFeature } = require("../middleware/requireFeature");
const {
  verifyTripParticipantAccessToken,
  sendTripParticipantAccessLinks,
  appBaseUrl,
} = require("../utils/tripAccessToken");
const { buildSignedDocumentPdf } = require("../utils/pdfGeneration");
const { decodePhotoDataUrl } = require("../utils/participantPhoto");
const { renderSubscriberPage, escapeHtml } = require("../utils/subscriberPage");
const { tripDocumentUpload } = require("../utils/upload");
const { sendStoredFile, safeFilename } = require("../utils/fileResponse");
const { verifyUpload } = require("../utils/fileSignature");
const { buildMeetingIcs } = require("../utils/tripEmails");
const { isMinorForTrip } = require("../utils/tripParticipantSchema");
const { getSettings, partnerFieldLabel, tripPartnerSelect } = require("../utils/publicTripShared");
const crypto = require("crypto");
const { makeDisplayCopy } = require("../utils/photoCopies");

// Shared with the admin TripDocument upload route (trips.js): same allowlist and size cap.
const upload = tripDocumentUpload();

const router = express.Router();

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
      hasPhoto: !!participant.photoContentType,
      supportRaisingGoal: participant.supportRaisingGoal,
      raised,
      trip: {
        name: participant.trip.name,
        type: participant.trip.type,
        // Unmasked like name/dates: masking on this route covers partner identity, not trip-level free text.
        description: participant.trip.description,
        startDate: participant.trip.startDate,
        endDate: participant.trip.endDate,
        fieldDisplayName: partnerFieldLabel(participant.trip.partner, settings),
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

// GET /api/public/trip-participants/access?token=... -- the self-service page. Never blocked or masked.
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
            // rsvps filtered to this participant (at most one row, unique on meetingId+participantId) so the
            // page can show a prior answer.
            meetings: { include: { rsvps: { where: { participantId: payload.id } } } },
            // Explicit select: an un-selected include would load every document's raw bytes/signatureImage
            // into memory on each page load (it bit the admin trip-detail route in production, commit
            // 4aa3534), though neither is used here.
            documents: {
              where: { OR: [{ participantId: payload.id }, { participantId: null }] },
              select: {
                id: true,
                participantId: true,
                requirementId: true,
                title: true,
                fileName: true,
                fileSize: true,
                createdAt: true,
              },
            },
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
    // Every requirement, not just missing ones, so the page can show a due date and done/needed
    // state. A "document" row is fulfilled per the anti-join against TripDocument; a "task" row by
    // this participant's TripRequirementStatus.completedAt.
    // #278: a minors-only requirement is excluded entirely for a non-minor participant.
    const requirements = participant.trip.requirements
      .filter((req) => !req.minorsOnly || isMinorForTrip(participant.dateOfBirth, participant.trip.startDate))
      .map((req) => ({
        id: req.id,
        label: req.label,
        kind: req.kind,
        dueAt: req.dueAt,
        // Only meaningful for kind "esignature": the agreement text shown before signing; null otherwise.
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
      hasPhoto: !!participant.photoContentType,
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
        // A segment with nobody selected applies to the whole team; otherwise only to those selected.
        // Filtered server-side (#265) so this page cannot be used to enumerate who else is on a segment.
        flightSegments: participant.trip.flightSegments
          .filter(
            (seg) => seg.participants.length === 0 || seg.participants.some((p) => p.id === participant.id)
          )
          .map(({ participants, ...seg }) => seg),
        fieldDisplayName:
          participant.trip.partner?.fieldDisplayName || participant.trip.partner?.displayName || null,
      },
      // Cancelled meetings are dropped, not marked: the participant already got a cancellation notice,
      // and a cancelled entry in their itinerary reads as "still happening?". Admins see the unfiltered view.
      meetings: participant.trip.meetings
        .filter((m) => !m.cancelledAt)
        // rsvps -> myRsvp: only this participant's own answer (or null).
        .map(({ rsvps, ...m }) => ({ ...m, myRsvp: rsvps[0]?.response || null })),
      requirements,
      // Trip-wide documents only (participantId: null), metadata only; bytes come from GET
      // /participants/documents/:id/download. A participant's OWN documents (passport photo, signed
      // waiver) are never listed; they show as requirements[].fulfilled.
      tripWideDocuments: participant.trip.documents
        .filter((d) => !d.participantId)
        .map(({ id: docId, title, fileName, fileSize, createdAt }) => ({
          id: docId,
          title,
          fileName,
          fileSize,
          createdAt,
        })),
      giving: {
        onlineGivingUrl: settings?.onlineGivingUrl || null,
        onlineGivingInstructions: settings?.onlineGivingInstructions || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /participants/documents/:id/download -- token-gated counterpart to trips.js's admin
// download (behind requireAuth, unusable by a no-login page). Scoped to trip-wide documents
// (participantId: null) on the token's OWN trip, never another participant's.
router.get("/participants/documents/:id/download", requireFeature("trips"), async (req, res, next) => {
  try {
    const payload = verifyTripParticipantAccessToken(String(req.query.token || ""));
    if (!payload) return res.status(401).json({ error: "Invalid or expired link" });

    const participant = await prisma.tripParticipant.findUnique({ where: { id: payload.id } });
    if (!participant || participant.accessTokenVersion !== payload.v) {
      return res.status(401).json({ error: "Invalid or expired link" });
    }

    const record = await prisma.tripDocument.findUnique({
      where: { id: req.params.id },
      include: { bytesRow: { select: { bytes: true } } },
    });
    if (!record?.bytesRow || record.tripId !== participant.tripId || record.participantId !== null) {
      return res.status(404).json({ error: "Not found" });
    }
    sendStoredFile(res, { ...record, bytes: record.bytesRow.bytes });
  } catch (err) {
    next(err);
  }
});

const signSchema = z.object({
  token: z.string(),
  signerName: z.string().min(1),
  // "self" | "parent/guardian" -- recordkeeping only, never verified (see
  // TripDocument.signerRelationship in schema.prisma).
  signerRelationship: z.string().optional().nullable(),
  // Base64 data URL from the canvas, e.g. "data:image/png;base64,..."; optional (a participant may
  // just type a name). Stripped to raw bytes below; never trusted as anything but opaque image bytes.
  signatureImage: z.string().optional().nullable(),
});

// POST /api/public/trips/participants/sign/:requirementId -- the one write action on this
// otherwise read-only surface. Authenticated by the signed access token (in the body, as a POST).
router.post("/participants/sign/:requirementId", requireFeature("trips"), async (req, res, next) => {
  try {
    const { token, signerName, signerRelationship, signatureImage } = signSchema.parse(req.body);

    const payload = verifyTripParticipantAccessToken(token);
    if (!payload) return res.status(401).json({ error: "Invalid or expired link" });

    const participant = await prisma.tripParticipant.findUnique({
      where: { id: payload.id },
      include: { trip: { select: { name: true, type: true, startDate: true } } },
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
    // #278: a minors-only requirement never applies to a non-minor: nothing to sign.
    if (requirement.minorsOnly && !isMinorForTrip(participant.dateOfBirth, participant.trip.startDate)) {
      return res.status(404).json({ error: "Not found" });
    }
    const alreadySigned = await prisma.tripDocument.findFirst({
      where: { requirementId: requirement.id, participantId: participant.id },
      select: { id: true },
    });
    if (alreadySigned) {
      return res.status(400).json({ error: "This has already been signed" });
    }

    const documentText = requirement.bodyText || "";
    // Computed server-side, never trusted from the client: the hash detects a later edit to
    // bodyText, which only works if the server decided what was signed.
    const documentTextHash = crypto.createHash("sha256").update(documentText, "utf8").digest("hex");
    const attestedAt = new Date();

    let signatureImageBuffer = null;
    if (signatureImage) {
      const base64 = signatureImage.replace(/^data:image\/\w+;base64,/, "");
      signatureImageBuffer = Buffer.from(base64, "base64");
    }

    // The audit trail lives on the generated TripDocument itself, the one artifact anyone looks at.
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
        fileName: `${requirement.label.replace(/[^a-z0-9]+/gi, "-")}.pdf`,
        contentType: "application/pdf",
        fileSize: pdfBytes.length,
        signerName,
        signerRelationship: signerRelationship || null,
        attestedAt,
        ip,
        documentTextSnapshot: documentText,
        documentTextHash,
        bytesRow: { create: { bytes: pdfBytes, signatureImage: signatureImageBuffer } },
      },
    });

    res.status(201).json({ tripDocumentId: tripDocument.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/public/trips/participants/upload/:requirementId -- document-kind counterpart to sign.
// participantId comes ONLY from the verified token, so a caller can only upload against their own
// row. Upsert (TripDocument @@unique([requirementId, participantId])): re-uploading replaces the
// prior file.
// #327 Finding 4: the token is a query parameter verified in middleware ahead of upload.single, so
// multer never buffers up to 15 MB (utils/upload.js) for a caller with no valid token.
async function requireTripParticipantToken(req, res, next) {
  try {
    const payload = verifyTripParticipantAccessToken(String(req.query.token || ""));
    if (!payload) return res.status(401).json({ error: "Invalid or expired link" });

    const participant = await prisma.tripParticipant.findUnique({
      where: { id: payload.id },
      include: { trip: { select: { startDate: true } } },
    });
    if (!participant || participant.accessTokenVersion !== payload.v) {
      return res.status(401).json({ error: "Invalid or expired link" });
    }
    req.tripParticipant = participant;
    next();
  } catch (err) {
    next(err);
  }
}

router.post(
  "/participants/upload/:requirementId",
  requireFeature("trips"),
  requireTripParticipantToken,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const participant = req.tripParticipant;
      const requirement = await prisma.tripRequirement.findUnique({
        where: { id: req.params.requirementId },
      });
      if (!requirement || requirement.tripId !== participant.tripId) {
        return res.status(404).json({ error: "Not found" });
      }
      if (requirement.kind !== "document") {
        return res.status(400).json({ error: "This requirement doesn't accept an upload" });
      }
      // #278: a minors-only requirement never applies to a non-minor: nothing to upload against.
      if (requirement.minorsOnly && !isMinorForTrip(participant.dateOfBirth, participant.trip.startDate)) {
        return res.status(404).json({ error: "Not found" });
      }
      if (!req.file) return res.status(400).json({ error: "No file provided" });

      // #327 Finding 8: only jpg/png/webp/pdf are accepted (upload.js filter), all of which have a real
      // signature to verify.
      const verified = verifyUpload(req.file);
      if (!verified.ok) {
        return res.status(400).json({ error: "File content doesn't match its declared type" });
      }

      const bytes = req.file.buffer;
      const meta = {
        tripId: participant.tripId,
        participantId: participant.id,
        requirementId: requirement.id,
        title: requirement.label,
        fileName: req.file.originalname,
        contentType: verified.contentType,
        fileSize: req.file.size,
      };
      await prisma.tripDocument.upsert({
        where: {
          requirementId_participantId: { requirementId: requirement.id, participantId: participant.id },
        },
        create: { ...meta, bytesRow: { create: { bytes } } },
        update: { ...meta, bytesRow: { upsert: { create: { bytes }, update: { bytes } } } },
      });
      res.status(201).json({ uploaded: true });
    } catch (err) {
      next(err);
    }
  }
);

const selfServiceUpdateSchema = z.object({
  token: z.string(),
  story: z.string().optional().nullable(),
  // Base64 data URL, same shape the e-signature canvas already uses.
  photo: z.string().optional().nullable(),
  photoContentType: z.string().optional().nullable(),
});

// PUT /api/public/trip-participants/self-service -- the other write action, alongside signing.
// One route for story and photo edits (one actor, one trust boundary). No review step: participants
// already self-report address/emergency-contact/application answers unreviewed.
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
    if (photo) {
      const decoded = decodePhotoDataUrl(photo, photoContentType);
      const displayBytes = await makeDisplayCopy(decoded);
      data.photoBytesRow = {
        upsert: { create: { photo: decoded, displayBytes }, update: { photo: decoded, displayBytes } },
      };
    }
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
// The copy pages show (a JPEG at most 800px, or the full photo when it was small enough); /photo/raw is the full photo.
const sendParticipantPhoto = (wantFull) => async (req, res, next) => {
  try {
    const participant = await prisma.tripParticipant.findUnique({
      where: { id: req.params.id },
      select: {
        photoContentType: true,
        photoBytesRow: { select: wantFull ? { photo: true } : { photo: true, displayBytes: true } },
      },
    });
    if (!participant?.photoBytesRow) return res.status(404).json({ error: "Not found" });
    const row = participant.photoBytesRow;
    const display = !wantFull && row.displayBytes;
    res.set(
      "Content-Type",
      display ? "image/jpeg" : participant.photoContentType || "application/octet-stream"
    );
    res.set("Cache-Control", "public, max-age=3600");
    res.send(display ? row.displayBytes : row.photo);
  } catch (err) {
    next(err);
  }
};
router.get("/participants/:id/photo", requireFeature("trips"), sendParticipantPhoto(false));
router.get("/participants/:id/photo/raw", requireFeature("trips"), sendParticipantPhoto(true));

const RSVP_RESPONSES = new Set(["yes", "no", "maybe"]);
const RSVP_PAGE_LABELS = { yes: "attending", no: "not attending", maybe: "a maybe" };

// Link back to the self-service page so Yes/No/Maybe clicked from there does not strand the
// participant. The token is a signed JWT (base64url + dots), safe in an href, but escaped anyway
// since it is also a hidden form value.
function tripPageBackLink(token) {
  return `<a href="${appBaseUrl()}/my-trip?token=${encodeURIComponent(token)}" style="color:#2a5d3c;">Back to your trip page</a>`;
}

// #327 Finding 6: GET only validates and renders a confirm button (a plain <form method="POST">,
// works without JavaScript); POST records the RSVP. Recording on fetch would let a mail scanner
// that prefetches all three links overwrite the recipient's answer.
//
// validateRsvpRequest is shared by both routes: same checks, only the follow-up differs.
async function validateRsvpRequest(req, res) {
  const response = String(req.query.response ?? req.body?.response ?? "");
  if (!RSVP_RESPONSES.has(response)) {
    res.status(400).send(await renderSubscriberPage("This RSVP link is invalid.", "", "Meeting RSVP"));
    return null;
  }

  const token = String(req.query.token ?? req.body?.token ?? "");
  const payload = verifyTripParticipantAccessToken(token);
  if (!payload) {
    res
      .status(401)
      .send(await renderSubscriberPage("This link is invalid or has expired.", "", "Meeting RSVP"));
    return null;
  }

  const participant = await prisma.tripParticipant.findUnique({ where: { id: payload.id } });
  // Same accessTokenVersion check as /participants/access: a resend/regenerate bumps it, invalidating
  // every previously-issued link, RSVP links included.
  if (!participant || participant.accessTokenVersion !== payload.v) {
    res
      .status(401)
      .send(await renderSubscriberPage("This link is invalid or has expired.", "", "Meeting RSVP"));
    return null;
  }

  const meeting = await prisma.tripMeeting.findUnique({ where: { id: req.params.meetingId } });
  if (!meeting || meeting.tripId !== participant.tripId) {
    res.status(404).send(await renderSubscriberPage("This meeting couldn't be found.", "", "Meeting RSVP"));
    return null;
  }
  // A cancelled meeting has nothing to RSVP to: say so rather than record a response.
  if (meeting.cancelledAt) {
    res
      .status(400)
      .send(
        await renderSubscriberPage(
          "This meeting has been cancelled, so there's nothing left to RSVP to.",
          "",
          "Meeting RSVP"
        )
      );
    return null;
  }

  return { response, token, participant, meeting };
}

router.get("/meetings/:meetingId/rsvp", requireFeature("trips"), async (req, res, next) => {
  try {
    const valid = await validateRsvpRequest(req, res);
    if (!valid) return;
    const { response, token } = valid;
    const safeToken = escapeHtml(token);
    res.send(
      await renderSubscriberPage(
        (highlightColor) =>
          `Click below to mark yourself as <strong>${RSVP_PAGE_LABELS[response]}</strong> for this meeting.<br><br><form method="POST" action="${req.baseUrl}${req.path}"><input type="hidden" name="token" value="${safeToken}"><input type="hidden" name="response" value="${response}"><button type="submit" style="background:${highlightColor};color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:15px;cursor:pointer;">Confirm ${RSVP_PAGE_LABELS[response]}</button></form><br>${tripPageBackLink(token)}`,
        "",
        "Meeting RSVP"
      )
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  "/meetings/:meetingId/rsvp",
  requireFeature("trips"),
  express.urlencoded({ extended: false }),
  async (req, res, next) => {
    try {
      const valid = await validateRsvpRequest(req, res);
      if (!valid) return;
      const { response, token, participant, meeting } = valid;

      // Upsert on (meetingId, participantId): changing your mind overwrites the earlier response.
      await prisma.tripMeetingRsvp.upsert({
        where: { meetingId_participantId: { meetingId: meeting.id, participantId: participant.id } },
        create: { meetingId: meeting.id, participantId: participant.id, response, respondedAt: new Date() },
        update: { response, respondedAt: new Date() },
      });

      res.send(
        await renderSubscriberPage(
          `Got it — you're marked as <strong>${RSVP_PAGE_LABELS[response]}</strong> for this meeting. You can click a different link in the email anytime to change your response.<br><br>${tripPageBackLink(token)}`,
          "",
          "Meeting RSVP"
        )
      );
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/public/trips/meetings/:meetingId/ics?token=... -- "Add to calendar" download for the
// self-service page. Same token/ownership checks as the RSVP route; GET since it is a file fetch
// that mutates nothing.
router.get("/meetings/:meetingId/ics", requireFeature("trips"), async (req, res, next) => {
  try {
    const payload = verifyTripParticipantAccessToken(String(req.query.token || ""));
    if (!payload) return res.status(401).json({ error: "Invalid or expired link" });

    const participant = await prisma.tripParticipant.findUnique({ where: { id: payload.id } });
    if (!participant || participant.accessTokenVersion !== payload.v) {
      return res.status(401).json({ error: "Invalid or expired link" });
    }

    const meeting = await prisma.tripMeeting.findUnique({ where: { id: req.params.meetingId } });
    if (!meeting || meeting.tripId !== participant.tripId) {
      return res.status(404).json({ error: "Not found" });
    }

    const filename = safeFilename(`${meeting.title || "meeting"}.ics`);
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.set("Cache-Control", "private, no-store");
    res.send(buildMeetingIcs(meeting, { cancelled: !!meeting.cancelledAt }));
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
