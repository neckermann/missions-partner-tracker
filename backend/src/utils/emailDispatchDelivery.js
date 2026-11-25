// The shared admin+public send loop.
const prisma = require("../prismaClient");
const { isDemoInstance } = require("./demoMode");
const { DIGEST_ROLES } = require("./digestRoles");
const { isFeatureEnabled } = require("./features");
const { sendEmailBatch } = require("./email");
const { buildBlurb } = require("./dispatchBlurbs");
const { CHANNELS, isEligibleForChannel } = require("./dispatchEligibility");
const {
  buildEmailDispatchMessage,
  buildUnsubscribeUrl,
  buildSubscriberUnsubscribeUrl,
  partnerTileDetails,
} = require("./emailDispatchShell");
const { buildAdminEmailDispatchContent } = require("./adminEmailDispatchContent");
const { buildPublicEmailDispatchContent } = require("./publicEmailDispatchContent");

// Sent in chunks of 250, well under Postmark's 500-message/50MB per-call cap on
// POST /email/batch. One combined stream, not split by audience: each message is
// independently addressed and rendered, so splitting would only add calls.
const BATCH_CHUNK_SIZE = 250;

// Same shape regardless of source table; allPartners/partnerIds mean the same for both.
function normalizeRecipient(source, kind) {
  return {
    id: source.id,
    email: source.email,
    // PublicSubscriber has no first/last name, so this composes to null for that kind.
    name: [source.firstName, source.lastName].filter(Boolean).join(" ") || null,
    kind, // CHANNELS.EMAIL_ADMIN | CHANNELS.EMAIL_PUBLIC
    cadence: source.cadence,
    allPartners: source.allPartners,
    partnerIds:
      kind === CHANNELS.EMAIL_ADMIN
        ? source.followedPartners.map((fp) => fp.partnerId)
        : source.scopedPartners.map((sp) => sp.partnerId),
  };
}

async function fetchPartnerTileDetailsById(partnerIds) {
  const fullPartners = await prisma.partner.findMany({
    where: { id: { in: partnerIds } },
    select: {
      id: true,
      kind: true,
      isRestricted: true,
      fieldDisplayName: true,
      supportingSince: true,
      overviewShort: true,
      adults: { select: { id: true } },
      children: { select: { id: true } },
      photos: { orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }], take: 1, select: { id: true } },
    },
  });
  return new Map(fullPartners.map((p) => [p.id, partnerTileDetails(p)]));
}

// The reusable core: given rows and an assembled recipient list (tier-filtered
// for scheduled sends, cadence-blind for urgent; see sendUrgentDispatch), builds
// each recipient's message and sends in chunks. Returns the Set of row ids
// included in at least one send; the caller stamps the column(s).
async function sendToRecipients(rows, partnerById, recipients, settings) {
  const consideredIds = new Set();
  if (recipients.length === 0) return consideredIds;

  const needsTiles = settings?.emailDispatchLayout === "snapshot";
  const partnerDetailsById = needsTiles
    ? await fetchPartnerTileDetailsById([...new Set(rows.map((row) => row.partnerId))])
    : undefined;

  const messages = []; // built up across every recipient, sent in chunks after this loop

  for (const recipient of recipients) {
    // Rules 1 and 2 are recipient-independent; recomputed per recipient anyway, which is cheap at this scale.
    const eligibleRows = rows.filter((row) =>
      isEligibleForChannel(
        row,
        recipient.kind,
        partnerById.get(row.partnerId),
        settings,
        recipient.allPartners || recipient.partnerIds.includes(row.partnerId)
      )
    );
    if (eligibleRows.length === 0) continue;
    eligibleRows.forEach((row) => consideredIds.add(row.id));

    const blurbs = eligibleRows.map((row) => buildBlurb(row, partnerById.get(row.partnerId))).filter(Boolean);
    const content =
      recipient.kind === CHANNELS.EMAIL_ADMIN
        ? buildAdminEmailDispatchContent(blurbs, partnerDetailsById, settings)
        : buildPublicEmailDispatchContent(blurbs, partnerDetailsById, settings);

    const unsubscribeUrl =
      recipient.kind === CHANNELS.EMAIL_ADMIN
        ? buildUnsubscribeUrl(recipient.id)
        : buildSubscriberUnsubscribeUrl(recipient.id);
    // rowIds travels with its message so a failed send can record which
    // DispatchRecord row(s) it would have delivered (the "Dispatch send failures"
    // notification). Approximate: one recipient's bounce is attributed to every
    // row in their digest.
    messages.push({
      payload: buildEmailDispatchMessage(recipient, content, settings, unsubscribeUrl),
      rowIds: eligibleRows.map((row) => row.id),
    });
  }

  for (let i = 0; i < messages.length; i += BATCH_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + BATCH_CHUNK_SIZE);
    // sendEmailBatch returns one entry per message in submission order, each with
    // its own success/failure, so a bad address affects no other message. Batching
    // reduces API calls, not emails sent or billed (see email.js).
    const results = await sendEmailBatch(chunk.map((m) => m.payload));
    for (const [idx, result] of results.entries()) {
      if (result.ErrorCode !== 0) {
        console.error(`Email dispatch to ${chunk[idx].payload.To} failed:`, result.Message);
        await prisma.dispatchRecord.updateMany({
          where: { id: { in: chunk[idx].rowIds } },
          data: { emailError: result.Message || "Unknown delivery failure" },
        });
      }
    }
  }

  return consideredIds;
}

// The scheduled send pass for one cadence tier ("biweekly"|"monthly"|"quarterly").
// Returns { consideredIds } for emailDispatchScheduler.js to stamp with this
// tier's column; empty, touching nothing, if outboundEmail is off or nothing to send.
async function sendDigestTier(tier, settings) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return { consideredIds: [] };
  if (await isDemoInstance()) return { consideredIds: [] };

  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { consideredIds: [] };

  const partners = await prisma.partner.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
    select: { id: true, displayName: true, fieldDisplayName: true, isRestricted: true, isPublic: true },
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  // The public digest sends only if outboundEmail AND publicPrayerDigest are on:
  // turning publicPrayerDigest off must stop mail to already-confirmed subscribers, not just new signups.
  const publicDigestOn = isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");

  // The cadence-tier match happens in each query's `where`, before normalization, not in sendToRecipients.
  const [admins, publicSubscribers] = await Promise.all([
    prisma.user.findMany({
      // Never a guest: the digest is the whole church's content, not a scoped login's.
      where: { cadence: tier, active: true, role: { in: DIGEST_ROLES } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        cadence: true,
        allPartners: true,
        followedPartners: { select: { partnerId: true } },
      },
    }),
    publicDigestOn
      ? prisma.publicSubscriber.findMany({
          where: { cadence: tier, confirmedAt: { not: null } },
          select: {
            id: true,
            email: true,
            cadence: true,
            allPartners: true,
            scopedPartners: { select: { partnerId: true } },
          },
        })
      : [],
  ]);
  const recipients = [
    ...admins.map((u) => normalizeRecipient(u, CHANNELS.EMAIL_ADMIN)),
    ...publicSubscribers.map((s) => normalizeRecipient(s, CHANNELS.EMAIL_PUBLIC)),
  ];

  const consideredIds = await sendToRecipients(rows, partnerById, recipients, settings);
  return { consideredIds: [...consideredIds] };
}

module.exports = {
  normalizeRecipient,
  sendToRecipients,
  sendDigestTier,
};
