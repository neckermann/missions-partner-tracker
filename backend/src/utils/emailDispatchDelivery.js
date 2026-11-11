// The shared admin+public send loop -- renamed from scopedDigest.js.
// "Scoped" only ever meant something in contrast to the old unscoped
// church-wide batch mechanism, which is retired; there's no more
// "unscoped" variant for "scoped" to contrast against, so the name
// stopped meaning anything distinguishing.
const prisma = require("../prismaClient");
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

// Sent in chunks of 250 -- well under Postmark's documented 500-message/
// 50MB cap per call to POST /email/batch, leaving headroom so a chunk
// never gets close to either limit even for a church with unusually
// large digest bodies. One combined stream, not split by audience --
// admin and public messages can land in the same chunk; each message is
// independently addressed and rendered regardless of which audience
// it's for, so splitting them would only mean more total chunk calls
// for no benefit.
const BATCH_CHUNK_SIZE = 250;

// Same shape regardless of source table -- email/name/kind/cadence drive
// everything else; allPartners/partnerIds mean the same thing for both.
function normalizeRecipient(source, kind) {
  return {
    id: source.id,
    email: source.email,
    name: source.name || null,
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

// The reusable core: given a set of rows and an already-assembled
// recipient list (tier-filtered for the scheduled send, cadence-blind
// for an urgent dispatch -- see dispatchOrchestrator.js's
// sendUrgentDispatch), builds every recipient's personalized message
// and dispatches them in chunks. Returns the Set of row ids actually
// included in at least one recipient's send -- the caller stamps
// whichever column(s) apply.
async function sendToRecipients(rows, partnerById, recipients, settings) {
  const consideredIds = new Set();
  if (recipients.length === 0) return consideredIds;

  const needsTiles = settings?.emailDispatchLayout === "snapshot";
  const partnerDetailsById = needsTiles
    ? await fetchPartnerTileDetailsById([...new Set(rows.map((row) => row.partnerId))])
    : undefined;

  const messages = []; // built up across every recipient, sent in chunks after this loop

  for (const recipient of recipients) {
    // Rules 1 and 2 give the same answer for every recipient on this
    // pass (they never read anything recipient-specific) -- recomputed
    // per recipient anyway rather than hoisted out, since this app's
    // scale (a handful of partners and subscribers per church) makes
    // that redundancy cheap.
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
    messages.push(buildEmailDispatchMessage(recipient, content, settings, unsubscribeUrl));
  }

  for (let i = 0; i < messages.length; i += BATCH_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + BATCH_CHUNK_SIZE);
    // sendEmailBatch returns one response entry per message, in the
    // same order submitted -- each with its own success/failure, so one
    // bad address in a chunk never affects any other message in that
    // same chunk or any other chunk. Batching doesn't reduce the number
    // of emails sent or billed -- only the number of API calls; see
    // email.js's own comment.
    const results = await sendEmailBatch(chunk);
    results.forEach((result, idx) => {
      if (result.ErrorCode !== 0) {
        console.error(`Email dispatch to ${chunk[idx].To} failed:`, result.Message);
      }
    });
  }

  return consideredIds;
}

// The scheduled send pass for one cadence tier
// ("biweekly"|"monthly"|"quarterly"). Returns { consideredIds } --
// emailDispatchScheduler.js stamps exactly these ids with this tier's column.
// Returns { consideredIds: [] } without touching anything if
// outboundEmail is off or there's simply nothing to send.
async function sendDigestTier(tier, settings) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) return { consideredIds: [] };

  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { consideredIds: [] };

  const partners = await prisma.partner.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
    select: { id: true, displayName: true, isRestricted: true, isPublic: true },
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  // The public digest's send pass runs only if outboundEmail AND
  // publicPrayerDigest are both on -- turning publicPrayerDigest off
  // after subscribers already confirmed must actually stop their mail,
  // not just block new signups (publicSubscribe.js already handles the
  // signup side; this is the send side).
  const publicDigestOn = isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");

  // admins/publicSubscribers are each queried with `cadence: tier`
  // already in their own `where` clause -- the cadence-tier match
  // happens here, before normalization, not inside sendToRecipients.
  const [admins, publicSubscribers] = await Promise.all([
    prisma.user.findMany({
      where: { cadence: tier, active: true },
      select: {
        id: true,
        email: true,
        name: true,
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
