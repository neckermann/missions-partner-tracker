const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { decryptField } = require("../utils/crypto");
const { isFeatureEnabled } = require("../utils/features");
const { sendStoredFile } = require("../utils/fileResponse");
const { notifyNewsletterCreated } = require("../utils/dispatchRecording");
const { partnerRefSelect } = require("../utils/prismaIncludes");
const { FILE_KINDS } = require("./fileKinds");

// Mixed router: POST /postmark is called by Postmark and authenticates via
// HTTP Basic Auth (checkWebhookAuth), never requireAuth. Everything else is
// the admin-facing review queue for emails that couldn't be auto-matched.
const router = express.Router();

// Postmark has no HMAC signature for inbound webhooks; the webhook URL carries
// Basic Auth credentials instead. Compared in constant time so a guesser can't
// time the comparison.
function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

// Best-effort: a logging failure must never mask the real error/response.
// Deliberately NOT called for "no webhook credentials configured" or "feature
// off" -- those aren't processing failures, and persisting them would be noise
// from automated probers.
async function recordInboundEmailFailure(reason, payload) {
  try {
    const snippet = JSON.stringify(payload ?? {}).slice(0, 2000);
    await prisma.inboundEmailFailure.create({ data: { reason, rawPayloadSnippet: snippet } });
  } catch (err) {
    console.error("Could not record inbound email failure:", err.message);
  }
}

// `From` is trivially forgeable: without this check, anyone who knows a
// partner's email could have a document queued as coming from that partner with a
// reassuring reason. Keep it (it only changes the note; every message is reviewed).
//
// Postmark's inbound JSON has no Authentication-Results header; only two
// `Headers` entries carry a signal:
//   - "Received-SPF": a bare token ("pass", "fail", ...) or longer prose
//     ("Pass (sender SPF authorized) ..."), so check it starts with "pass",
//     case-insensitively.
//   - "X-Spam-Tests": includes "DKIM_VALID" when DKIM verified. SpamAssassin
//     headers may be absent, so this is a best-effort secondary signal.
// Fails closed: missing Headers or neither signal counts as unverified.
function isSenderVerified(headers) {
  if (!Array.isArray(headers)) return false;
  const byName = (name) => headers.find((h) => h?.Name?.toLowerCase() === name.toLowerCase())?.Value || "";
  const spf = byName("Received-SPF").trim().toLowerCase();
  if (spf.startsWith("pass")) return true;
  const spamTests = byName("X-Spam-Tests");
  return spamTests.toUpperCase().includes("DKIM_VALID");
}

function checkWebhookAuth(req, expectedUsername, expectedPassword) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;

  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  return (
    timingSafeStringEqual(username, expectedUsername) && timingSafeStringEqual(password, expectedPassword)
  );
}

// POST /api/inbound-email/postmark -- the webhook. Always 200s once the payload
// is valid: "queued for review" is the only outcome, and a non-200 would make
// Postmark retry delivery.
router.post("/postmark", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: {
        inboundEmailWebhookUsername: true,
        inboundEmailWebhookPassword: true,
        inboundEmailSkipReview: true,
        enabledFeatures: true,
      },
    });

    // Never treat an empty expected credential as matching an empty/missing one.
    if (!settings?.inboundEmailWebhookUsername || !settings?.inboundEmailWebhookPassword) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expectedPassword = decryptField(settings.inboundEmailWebhookPassword);
    if (!checkWebhookAuth(req, settings.inboundEmailWebhookUsername, expectedPassword)) {
      // Deliberately no recordInboundEmailFailure here: an unauthenticated
      // caller must not be able to trigger a DB write.
      return res.status(401).json({ error: "Unauthorized" });
    }
    // After auth, so a wrong password and a right password with the feature
    // off look identical to anyone without the credentials.
    if (!isFeatureEnabled(settings.enabledFeatures, "inboundEmail")) {
      return res.status(404).json({ error: "Not found" });
    }

    const payload = req.body || {};
    const fromAddress = payload.FromFull?.Email || payload.From;
    const rawEmail = payload.RawEmail;
    if (!fromAddress || !rawEmail) {
      await recordInboundEmailFailure("Missing From/RawEmail in payload", payload);
      return res.status(400).json({ error: "Missing From/RawEmail in payload" });
    }

    // RawEmail is the full RFC 822 message as plain text (not base64), i.e. the .eml source.
    const bytes = Buffer.from(rawEmail, "utf8");
    const fileName = `inbound-${payload.MessageID || crypto.randomUUID()}.eml`;
    const subject = payload.Subject || null;

    // Match on the partner's contactEmail (organizations) or any linked
    // Adult's email (missionaries); contactEmail alone would miss most partners.
    const matches = await prisma.partner.findMany({
      where: {
        OR: [
          { contactEmail: { equals: fromAddress, mode: "insensitive" } },
          { adults: { some: { email: { equals: fromAddress, mode: "insensitive" } } } },
        ],
      },
      select: { id: true },
    });

    // By default nothing is filed or announced straight from the webhook: the sender address is forgeable and
    // the SPF/DKIM signal is best-effort, so every message waits in the queue for a person to look at it.
    // An admin can switch the review off (Settings, Email); then, and only then, a message from an address
    // that matches exactly one partner AND passed SPF/DKIM is filed as that partner's newsletter and
    // announced. Everything else still waits.
    if (settings.inboundEmailSkipReview && matches.length === 1 && isSenderVerified(payload.Headers)) {
      const created = await prisma.partnerFile.create({
        data: {
          partnerId: matches[0].id,
          kind: "newsletter",
          title: subject,
          receivedDate: new Date(),
          fileName,
          contentType: "message/rfc822",
          fileSize: bytes.length,
          notes: "Received via inbound email.",
          bytesRow: { create: { bytes } },
        },
        include: { partner: partnerRefSelect },
      });
      // A broken notification channel must never affect whether this email got filed.
      await notifyNewsletterCreated(created).catch((err) =>
        console.error("Couldn't announce an inbound newsletter:", err.message)
      );
      return res.status(200).json({ matched: true });
    }

    // queueReason tells the reviewing admin why (and, for a verified single match, that it is likely fine).
    let queueReason = null;
    if (matches.length === 1) {
      queueReason = isSenderVerified(payload.Headers)
        ? "Matched a partner by sender address and SPF/DKIM confirmed it. Held for a quick look before it is filed and announced."
        : "Matched a partner by sender address, but SPF/DKIM didn't confirm it -- review before assigning.";
    }
    await prisma.inboundEmail.create({
      data: { fromAddress, subject, fileName, queueReason, bytesRow: { create: { bytes } } },
    });
    res.status(200).json({ matched: false });
  } catch (err) {
    await recordInboundEmailFailure(`Unexpected error: ${err.message}`, req.body).catch(() => {});
    next(err);
  }
});

// Everything below is the admin-facing review queue.
router.use(requireAuth);
router.use(requireFeature("inboundEmail"));

const inboundEmailInclude = {};

// Guests are excluded entirely: the queue holds every unmatched sender address
// and raw .eml, and being attached to no partner or trip it has no scoped
// version. Keep requireRole here and on /:id/raw.
router.get("/", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const records = await prisma.inboundEmail.findMany({
      ...inboundEmailInclude,
      orderBy: { receivedAt: "desc" },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/inbound-email/:id/raw -- lets an admin read the email before
// deciding who it's from. contentType is always message/rfc822, so it isn't
// stored. Same guest exclusion as GET / above.
router.get("/:id/raw", requireRole("admin", "editor", "viewer"), async (req, res, next) => {
  try {
    const record = await prisma.inboundEmail.findUnique({
      where: { id: req.params.id },
      include: { bytesRow: { select: { bytes: true } } },
    });
    if (!record?.bytesRow) return res.status(404).json({ error: "Not found" });
    sendStoredFile(res, { ...record, bytes: record.bytesRow.bytes, contentType: "message/rfc822" });
  } catch (err) {
    next(err);
  }
});

// kind defaults to "newsletter". customKind is required when kind is "other",
// mirroring partnerFiles.js's metaSchema. Exactly one of partnerId or
// tripParticipantId; requirementId is optional even for a TripDocument.
const assignSchema = z
  .object({
    partnerId: z.string().optional(),
    tripParticipantId: z.string().optional(),
    requirementId: z.string().optional().nullable(),
    kind: z.enum(FILE_KINDS).default("newsletter"),
    customKind: z.string().optional().nullable(),
  })
  .refine((data) => data.kind !== "other" || Boolean(data.customKind?.trim()), {
    message: 'customKind is required when kind is "other"',
    path: ["customKind"],
  })
  .refine((data) => Boolean(data.partnerId) !== Boolean(data.tripParticipantId), {
    message: "Provide exactly one of partnerId or tripParticipantId",
    path: ["partnerId"],
  });

// POST /api/inbound-email/:id/assign -- files the email as the chosen kind.
router.post("/:id/assign", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { partnerId, tripParticipantId, requirementId, kind, customKind } = assignSchema.parse(req.body);

    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });

    // Excludes `bytes` (the raw .eml) here; it is re-fetched only by the
    // branch that creates the file.
    const record = await prisma.inboundEmail.findUnique({
      where: { id: req.params.id },
      select: { id: true, subject: true, fileName: true, receivedAt: true },
    });
    if (!record) return res.status(404).json({ error: "Not found" });

    if (tripParticipantId) {
      if (!isFeatureEnabled(settings?.enabledFeatures, "trips")) {
        return res.status(404).json({ error: "Not found" });
      }
      const participant = await prisma.tripParticipant.findUnique({
        where: { id: tripParticipantId },
        select: { id: true, tripId: true },
      });
      if (!participant) return res.status(400).json({ error: "That participant no longer exists" });

      const emailBytesRow = await prisma.inboundEmail.findUnique({
        where: { id: req.params.id },
        select: { bytesRow: { select: { bytes: true } } },
      });
      const created = await prisma.tripDocument.create({
        data: {
          tripId: participant.tripId,
          participantId: participant.id,
          requirementId: requirementId || null,
          title: record.subject,
          fileName: record.fileName,
          contentType: "message/rfc822",
          fileSize: emailBytesRow.bytesRow.bytes.length,
          bytesRow: { create: { bytes: emailBytesRow.bytesRow.bytes } },
        },
      });
      await prisma.inboundEmail.delete({ where: { id: req.params.id } });
      return res.status(200).json(created);
    }

    // "partnerFiles" must be on too, not just "inboundEmail"; 404 like
    // requireFeature, so a disabled feature looks like the action doesn't exist.
    if (!isFeatureEnabled(settings?.enabledFeatures, "partnerFiles")) {
      return res.status(404).json({ error: "Not found" });
    }

    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!partner) return res.status(400).json({ error: "That partner no longer exists" });

    const emailBytesRow = await prisma.inboundEmail.findUnique({
      where: { id: req.params.id },
      select: { bytesRow: { select: { bytes: true } } },
    });
    const created = await prisma.partnerFile.create({
      data: {
        partnerId,
        kind,
        customKind: kind === "other" ? customKind : null,
        title: record.subject,
        receivedDate: record.receivedAt,
        fileName: record.fileName,
        contentType: "message/rfc822",
        fileSize: emailBytesRow.bytesRow.bytes.length,
        notes: "Received via inbound email.",
        bytesRow: { create: { bytes: emailBytesRow.bytesRow.bytes } },
      },
      include: { partner: partnerRefSelect },
    });
    await prisma.inboundEmail.delete({ where: { id: req.params.id } });

    try {
      await notifyNewsletterCreated(created);
    } catch (err) {
      console.error("Newsletter created notification failed:", err);
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/inbound-email/:id -- discards without filing anything.
router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const record = await prisma.inboundEmail.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!record) return res.status(404).json({ error: "Not found" });

    await prisma.inboundEmail.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
