// Public, unauthenticated participant surfaces for Trips (#252): a
// participant's public support-raising page (shareToken), self-service
// page (signed access token), e-signature/document-upload actions,
// photo, meeting RSVP/ICS, and lost-link recovery. Split out of the
// former publicTrips.js (#271 Finding) -- mounted at the same
// /api/public/trip-participants (and /api/public/trips/meetings)
// prefixes as publicTrips.js (discovery) and publicTripApplications.js
// from server.js, not a separate API surface.
//
// The signed-access-token self-service routes below are never blocked
// or masked for a restricted partner -- the person reading them is the
// one actually going. GET /participants/by-token/:shareToken MASKS a
// restricted partner instead (toInitials-style generic label) since
// reaching it already requires a secret only staff chose to share.
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
const { renderSubscriberPage } = require("../utils/subscriberPage");
const { tripDocumentUpload } = require("../utils/upload");
const { sendStoredFile, safeFilename } = require("../utils/fileResponse");
const { buildMeetingIcs } = require("../utils/tripEmails");
const { isMinorForTrip } = require("../utils/tripParticipantSchema");
const { getSettings, partnerFieldLabel, tripPartnerSelect } = require("../utils/publicTripShared");
const crypto = require("crypto");

// Shared with the admin TripDocument upload route (trips.js) -- same
// allowlist/size cap for both, see that helper's own comment.
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
            // rsvps filtered to just this participant -- at most one row
            // (unique on meetingId+participantId), so the self-service
            // page can show "you already said X" instead of always just
            // bare Yes/No/Maybe links with no memory of a prior answer.
            meetings: { include: { rsvps: { where: { participantId: payload.id } } } },
            // Explicit select, not a bare `where` -- same latent issue the
            // admin trip-detail route actually hit in production (commit
            // 4aa3534): an un-selected include here still pulls every
            // document's raw `bytes`/`signatureImage` into server memory
            // on every self-service page load, even though neither field
            // is ever used below (the fulfilled check only needs
            // requirementId/participantId, and tripWideDocuments below is
            // metadata-only). Never serialized to the client either way,
            // but no reason to carry multi-MB blobs through Prisma at all.
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
    // Generalized (#252 follow-on) -- every requirement, not just
    // missing ones, so the self-service page can show a due date and a
    // done/needed state per item rather than only ever a flat "still
    // needed" list. Fulfillment: a "document" row is the existing
    // anti-join against TripDocument; a "task" row is this participant's
    // own TripRequirementStatus.completedAt (already scoped to just this
    // participant by the `where` on requirementStatuses above).
    // #278 -- a minors-only requirement is excluded entirely for a
    // non-minor participant, not just hidden/disabled: there's nothing
    // for them to fulfill, so it shouldn't appear on their own list at
    // all.
    const requirements = participant.trip.requirements
      .filter((req) => !req.minorsOnly || isMinorForTrip(participant.dateOfBirth, participant.trip.startDate))
      .map((req) => ({
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
      hasPhoto: !!participant.photoContentType,
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
          .filter(
            (seg) => seg.participants.length === 0 || seg.participants.some((p) => p.id === participant.id)
          )
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
      meetings: participant.trip.meetings
        .filter((m) => !m.cancelledAt)
        // rsvps -> myRsvp: this participant's own prior response (or null),
        // not the raw per-participant-filtered array -- the frontend only
        // ever needs its own answer, never the shape of how that's queried.
        .map(({ rsvps, ...m }) => ({ ...m, myRsvp: rsvps[0]?.response || null })),
      requirements,
      // Trip-wide documents only (participantId: null) -- this
      // participant's OWN documents (passport photo, signed waiver) are
      // never exposed here; they're tracked via `requirements[].fulfilled`
      // above instead, not re-listed as files to avoid this page reading
      // like it's handing back someone's own uploaded ID photo as a
      // generic "document." Metadata only, consistent with the query
      // above -- actual bytes are fetched on demand via the GET
      // /participants/documents/:id/download route below.
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

// GET /participants/documents/:id/download -- the token-gated counterpart
// to trips.js's admin-only GET /documents/:id/download (that one sits
// behind router.use(requireAuth), which a self-service page with no login
// session can't use at all). Scoped strictly to trip-wide documents
// (participantId: null) on the token's OWN trip -- never a document
// belonging to another participant, even another participant on the same
// trip. Same token verification as every other self-service route here.
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
    // #278 -- a minors-only requirement never applies to a non-minor
    // participant, so there's nothing for them to sign.
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

// POST /api/public/trips/participants/upload/:requirementId -- the
// document-kind counterpart to the sign route above. Same signed-
// access-token authentication (token travels as a multipart field here,
// since the request body is multipart/form-data, not JSON -- multer
// parses both the file and the other fields before this handler runs).
// participantId is taken ONLY from the verified token, never from the
// request, so a caller can only ever upload against their own
// participant row. Upsert (TripDocument's @@unique([requirementId,
// participantId])): re-using the same link to upload a corrected file
// replaces the prior one rather than leaving both around for an admin
// to sort out -- same reasoning the admin-side upload route now follows
// too (see that route's own comment).
// #327 Finding 4: upload.single("file") used to run before the token was
// even checked, so multer buffered up to 15 MB into memory (utils/
// upload.js's own fileSize cap) for a caller with no token at all. The
// token moves to the query string (same convention every other route in
// this file already uses -- see verifyTripParticipantAccessToken's other
// two callers above) specifically so it can be read and verified in a
// middleware ahead of upload.single, instead of needing multer to have
// already parsed the multipart body first.
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
      // #278 -- a minors-only requirement never applies to a non-minor
      // participant, so there's nothing for them to upload against.
      if (requirement.minorsOnly && !isMinorForTrip(participant.dateOfBirth, participant.trip.startDate)) {
        return res.status(404).json({ error: "Not found" });
      }
      if (!req.file) return res.status(400).json({ error: "No file provided" });

      const bytes = req.file.buffer;
      const meta = {
        tripId: participant.tripId,
        participantId: participant.id,
        requirementId: requirement.id,
        title: requirement.label,
        fileName: req.file.originalname,
        contentType: req.file.mimetype || "application/octet-stream",
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
    if (photo) {
      const decoded = decodePhotoDataUrl(photo, photoContentType);
      data.photoBytesRow = { upsert: { create: { photo: decoded }, update: { photo: decoded } } };
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
router.get("/participants/:id/photo", requireFeature("trips"), async (req, res, next) => {
  try {
    const participant = await prisma.tripParticipant.findUnique({
      where: { id: req.params.id },
      select: { photoContentType: true, photoBytesRow: { select: { photo: true } } },
    });
    if (!participant?.photoBytesRow) return res.status(404).json({ error: "Not found" });
    res.set("Content-Type", participant.photoContentType || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(participant.photoBytesRow.photo);
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
      return res
        .status(404)
        .send(await renderSubscriberPage("This meeting couldn't be found.", "", "Meeting RSVP"));
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

    // A link back to the self-service page -- without this, clicking
    // Yes/No/Maybe from that page itself (not just from the original
    // email) strands the participant on this static confirmation page
    // with no way back except browser back. Safe to build directly: the
    // token already verified above is a signed JWT (base64url + dots),
    // nothing that could break out of an href attribute.
    const backLink = `<a href="${appBaseUrl()}/my-trip?token=${encodeURIComponent(
      req.query.token
    )}" style="color:#2a5d3c;">Back to your trip page</a>`;
    res.send(
      await renderSubscriberPage(
        `Got it — you're marked as <strong>${RSVP_PAGE_LABELS[response]}</strong> for this meeting. You can click a different link in the email anytime to change your response.<br><br>${backLink}`,
        "",
        "Meeting RSVP"
      )
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/public/trips/meetings/:meetingId/ics?token=... -- a direct
// "Add to calendar" download for the self-service page, so a participant
// doesn't have to dig up the original invite email's attachment to get a
// meeting onto their own calendar. Same token/ownership checks as the
// RSVP route just above (participant token valid, meeting belongs to
// their trip) -- GET, not POST, since this is just a file fetch a
// calendar app or browser link-click triggers, nothing mutates.
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
