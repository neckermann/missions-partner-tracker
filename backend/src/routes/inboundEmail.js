const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { decryptField } = require("../utils/crypto");
const { isFeatureEnabled } = require("../utils/features");
const { sendStoredFile } = require("../utils/fileResponse");
const { notifyNewsletterCreated } = require("../utils/notifications");
const { partnerRefSelect } = require("../utils/prismaIncludes");

// Mixed router (see #72): POST /postmark is called by Postmark directly,
// not a logged-in admin -- it authenticates via HTTP Basic Auth (see
// checkWebhookAuth below), never requireAuth/requireRole. Everything else
// here is the admin-facing review queue for emails that couldn't be
// auto-matched, same session-based gating as every other admin route.
const router = express.Router();

// Postmark has no HMAC signature verification for inbound webhooks -- the
// webhook URL itself carries Basic Auth credentials instead (confirmed
// against Rails' own ActionMailbox Postmark ingress, a real production
// implementation of the same thing). Constant-time comparison, same
// discipline as every other credential check in this app -- a connection
// a brute-forcing bot can hold open to time a string comparison byte-by-
// byte is exactly the scenario timingSafeEqual exists for.
function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
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

// POST /api/inbound-email/postmark -- the webhook. Always 200s once the
// payload itself is valid, regardless of whether the sender matched a
// partner -- "queued for review" is a normal outcome, not a failure, and
// a non-200 here would make Postmark retry delivery.
router.post("/postmark", async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { inboundEmailWebhookUsername: true, inboundEmailWebhookPassword: true, enabledFeatures: true },
    });

    // Nothing configured yet -- never treat an empty expected credential
    // as a match for an empty/missing one presented by the caller.
    if (!settings?.inboundEmailWebhookUsername || !settings?.inboundEmailWebhookPassword) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expectedPassword = decryptField(settings.inboundEmailWebhookPassword);
    if (!checkWebhookAuth(req, settings.inboundEmailWebhookUsername, expectedPassword)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    // Checked after auth, not before: a wrong-password attempt and a
    // right-password-but-feature-off attempt should look identical to
    // anyone who hasn't already proven they know the credentials.
    if (!isFeatureEnabled(settings.enabledFeatures, "inboundEmail")) {
      return res.status(404).json({ error: "Not found" });
    }

    const payload = req.body || {};
    const fromAddress = payload.FromFull?.Email || payload.From;
    const rawEmail = payload.RawEmail;
    if (!fromAddress || !rawEmail) {
      return res.status(400).json({ error: "Missing From/RawEmail in payload" });
    }

    // RawEmail is the full RFC 822 message as plain text (not base64 --
    // confirmed against Rails' ActionMailbox Postmark ingress, which
    // reads this same field the same way), so a plain UTF-8 buffer is
    // the raw .eml source, same shape as an uploaded Newsletter.bytes.
    const bytes = Buffer.from(rawEmail, "utf8");
    const fileName = `inbound-${payload.MessageID || crypto.randomUUID()}.eml`;
    const subject = payload.Subject || null;

    // Checks every partner's own contactEmail (organization-only field)
    // and every linked Adult's email (missionaries' own addresses, one
    // row per household adult -- see #72's plan for why contactEmail
    // alone would miss most partners). Case-insensitive: email addresses
    // are compared that way in practice everywhere else they're handled.
    const matches = await prisma.partner.findMany({
      where: {
        OR: [
          { contactEmail: { equals: fromAddress, mode: "insensitive" } },
          { adults: { some: { email: { equals: fromAddress, mode: "insensitive" } } } },
        ],
      },
      select: { id: true },
    });

    if (matches.length === 1) {
      const created = await prisma.newsletter.create({
        data: {
          partnerId: matches[0].id,
          receivedDate: new Date(),
          bytes,
          fileName,
          contentType: "message/rfc822",
          fileSize: bytes.length,
          notes: "Received via inbound email.",
        },
        include: { partner: partnerRefSelect },
        omit: { bytes: true },
      });
      // Best-effort, same reasoning as every other newsletter-creation
      // path -- a broken notification channel must never affect whether
      // this email got filed.
      await notifyNewsletterCreated(created);
      return res.status(200).json({ matched: true });
    }

    // Zero matches, or more than one distinct partner shares this
    // address (ambiguous) -- either way, don't guess. Queue it.
    await prisma.inboundEmail.create({ data: { fromAddress, subject, bytes, fileName } });
    res.status(200).json({ matched: false });
  } catch (err) {
    next(err);
  }
});

// Everything below is the admin-facing review queue -- a logged-in user,
// same as any other admin route.
router.use(requireAuth);
router.use(requireFeature("inboundEmail"));

const inboundEmailInclude = { omit: { bytes: true } };

// GET /api/inbound-email -- the pending queue, newest first. No role
// restriction beyond being logged in, same as GET /api/newsletters.
router.get("/", async (req, res, next) => {
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
// deciding who it's from. Same sendStoredFile helper
// newsletters.js's /:id/download uses; contentType is always
// message/rfc822 here so it isn't a stored column (see the model
// comment in schema.prisma).
router.get("/:id/raw", async (req, res, next) => {
  try {
    const record = await prisma.inboundEmail.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Not found" });
    sendStoredFile(res, { ...record, contentType: "message/rfc822" });
  } catch (err) {
    next(err);
  }
});

const assignSchema = z.object({ partnerId: z.string() });

// POST /api/inbound-email/:id/assign (editor or admin, matches
// newsletters.js's own create-role gating -- this creates a Newsletter,
// same as that route does).
router.post("/:id/assign", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { partnerId } = assignSchema.parse(req.body);

    const record = await prisma.inboundEmail.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Not found" });

    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!partner) return res.status(400).json({ error: "That partner no longer exists" });

    const created = await prisma.newsletter.create({
      data: {
        partnerId,
        receivedDate: record.receivedAt,
        bytes: record.bytes,
        fileName: record.fileName,
        contentType: "message/rfc822",
        fileSize: record.bytes.length,
        notes: "Received via inbound email.",
      },
      include: { partner: partnerRefSelect },
      omit: { bytes: true },
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

// DELETE /api/inbound-email/:id (admin only, matches newsletters.js's own
// delete-role gating) -- discards without filing anything.
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
