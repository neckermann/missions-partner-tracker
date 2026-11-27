// The shared admin+public send loop.
const prisma = require("../prismaClient");
const { isDemoInstance } = require("./demoMode");
const { DIGEST_RECIPIENT_ROLES } = require("./digestRoles");
const { resolveDigestScope } = require("./digestScope");
const { isFeatureEnabled } = require("./features");
const { sendEmailBatch } = require("./email");
const { buildBlurb } = require("./dispatchBlurbs");
const { loadOpenKeyDates } = require("./keyDateQueries");
const { CHANNELS, isEligibleForChannel } = require("./dispatchEligibility");
const { churchToday } = require("./today");
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

// Same shape regardless of source table; allPartners/partnerIds mean the same for both. An admin's scope
// (all / followed / the partners they look after) is resolved by the caller (resolveDigestScope) and passed in.
function normalizeRecipient(source, kind, scope) {
  return {
    id: source.id,
    email: source.email,
    // PublicSubscriber has no first/last name, so this composes to null for that kind.
    name: [source.firstName, source.lastName].filter(Boolean).join(" ") || null,
    kind, // CHANNELS.EMAIL_ADMIN | CHANNELS.EMAIL_PUBLIC
    cadence: source.cadence,
    allPartners: scope ? scope.allPartners : source.allPartners,
    partnerIds: scope
      ? scope.partnerIds
      : kind === CHANNELS.EMAIL_ADMIN
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
      isPublic: true,
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

// Writes the KeyDateReminder rows for what a digest just carried (one per date and heads-up, per person).
async function recordKeyDatesMailed(userId, keyDates) {
  if (!keyDates?.length) return;
  await prisma.keyDateReminder.createMany({
    data: keyDates.map((i) => ({
      userId,
      partnerId: i.partnerId,
      kind: i.kind,
      subjectId: i.subjectId,
      occurrenceDate: new Date(`${i.date}T00:00:00Z`),
      tier: i.tier,
    })),
    skipDuplicates: true,
  });
}

// The open key dates (final window and the earlier heads-ups) that this tier's staff haven't been mailed yet, by
// person. Empty while keyDates is off. A person who turned key-date email off (My account) gets none.
async function keyDatesForDigest(userIds, settings) {
  const byUser = new Map();
  if (!isFeatureEnabled(settings?.enabledFeatures, "keyDates") || userIds.length === 0) return byUser;
  const open = await loadOpenKeyDates(churchToday(), { withAdvance: true });
  if (open.length === 0) return byUser;

  const optedOut = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: userIds }, keyDateEmailOptOut: true },
        select: { id: true },
      })
    ).map((u) => u.id)
  );
  const done = await prisma.keyDateReminder.findMany({
    where: { userId: { in: userIds }, partnerId: { in: [...new Set(open.map((i) => i.partnerId))] } },
    select: { userId: true, partnerId: true, kind: true, subjectId: true, occurrenceDate: true, tier: true },
  });
  const key = (userId, i, date, tier) => `${userId}|${i.partnerId}|${i.kind}|${i.subjectId}|${date}|${tier}`;
  const sent = new Set(
    done.map((r) => key(r.userId, r, r.occurrenceDate.toISOString().slice(0, 10), r.tier))
  );
  for (const item of open) {
    for (const userId of item.recipientIds) {
      if (!userIds.includes(userId) || optedOut.has(userId)) continue;
      if (sent.has(key(userId, item, item.date, item.tier))) continue;
      byUser.set(userId, [...(byUser.get(userId) || []), item]);
    }
  }
  return byUser;
}

// The reusable core: given rows and an assembled recipient list (tier-filtered
// for scheduled sends, cadence-blind for urgent; see sendUrgentDispatch), builds
// each recipient's message and sends in chunks. Returns { deliveredIds, failedIds }:
// the row ids that reached at least one recipient (the caller stamps those, and only those:
// a row whose every send failed must stay unstamped so it goes out in a later pass), and the
// row ids a failed send would have carried (their error note must not be cleared).
async function sendToRecipients(rows, partnerById, recipients, settings, keyDatesByUser = new Map()) {
  const deliveredIds = new Set();
  const failedIds = new Set();
  if (recipients.length === 0) return { deliveredIds, failedIds };

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
    // Key dates only go to staff recipients, and a person with nothing else still gets them.
    const keyDates = recipient.kind === CHANNELS.EMAIL_ADMIN ? keyDatesByUser.get(recipient.id) || [] : [];
    if (eligibleRows.length === 0 && keyDates.length === 0) continue;

    // Only the currency is passed on: this path has never given buildBlurb the rest of the settings, and
    // handing them over would change how a restricted partner's name is masked in these emails.
    const blurbs = eligibleRows
      .map((row) => buildBlurb(row, partnerById.get(row.partnerId), { currency: settings?.currency }))
      .filter(Boolean);
    const content =
      recipient.kind === CHANNELS.EMAIL_ADMIN
        ? buildAdminEmailDispatchContent(blurbs, partnerDetailsById, settings, keyDates)
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
      userId: recipient.id,
      keyDates,
    });
  }

  let sentAny = false; // whether any message has already gone out in this pass
  for (let i = 0; i < messages.length; i += BATCH_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + BATCH_CHUNK_SIZE);
    // sendEmailBatch returns one entry per message in submission order, each with
    // its own success/failure, so a bad address affects no other message. Batching
    // reduces API calls, not emails sent or billed (see email.js).
    let results;
    try {
      results = await sendEmailBatch(chunk.map((m) => m.payload));
    } catch (err) {
      // The provider failed outright for this chunk. If nothing has gone out yet, let the error stop the pass:
      // the caller leaves everything unmarked and tries again on the next minute, and nobody gets two. If
      // earlier chunks already went out, finishing the pass is the only way not to send them again on that
      // retry, so this chunk is recorded as failed like any other failed message and the pass carries on.
      if (!sentAny) throw err;
      console.error("Email dispatch batch failed after earlier batches went out:", err.message);
      results = chunk.map(() => ({ ErrorCode: -1, Message: `Provider error: ${err.message}` }));
    }
    for (const [idx, result] of results.entries()) {
      if (result.ErrorCode !== 0) {
        console.error(`Email dispatch to ${chunk[idx].payload.To} failed:`, result.Message);
        chunk[idx].rowIds.forEach((id) => failedIds.add(id));
        await prisma.dispatchRecord.updateMany({
          where: { id: { in: chunk[idx].rowIds } },
          data: { emailError: result.Message || "Unknown delivery failure" },
        });
        continue;
      }
      // Delivered: this message's rows reached someone, and the key-date heads-ups it carried are recorded so
      // none repeats (a failed send records nothing and retries).
      sentAny = true;
      chunk[idx].rowIds.forEach((id) => deliveredIds.add(id));
      await recordKeyDatesMailed(chunk[idx].userId, chunk[idx].keyDates);
    }
  }

  return { deliveredIds, failedIds };
}

// The scheduled send pass for one cadence tier ("biweekly"|"monthly"|"quarterly").
// Returns { deliveredIds, failedIds } (arrays) for emailDispatchScheduler.js to stamp with this
// tier's column; empty, touching nothing, if outboundEmail is off or nothing to send.
async function sendDigestTier(tier, settings) {
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail"))
    return { deliveredIds: [], failedIds: [] };
  if (await isDemoInstance()) return { deliveredIds: [], failedIds: [] };

  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });

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
      // A guest is a recipient only through their own partners (digestScope is forced to "owned" for them).
      where: { cadence: tier, active: true, role: { in: DIGEST_RECIPIENT_ROLES } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        cadence: true,
        digestScope: true,
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
  const keyDatesByUser = await keyDatesForDigest(
    admins.map((u) => u.id),
    settings
  );
  if (rows.length === 0 && keyDatesByUser.size === 0) return { deliveredIds: [], failedIds: [] };
  const adminRecipients = await Promise.all(
    admins.map(async (u) => normalizeRecipient(u, CHANNELS.EMAIL_ADMIN, await resolveDigestScope(u)))
  );
  const recipients = [
    ...adminRecipients,
    ...publicSubscribers.map((s) => normalizeRecipient(s, CHANNELS.EMAIL_PUBLIC)),
  ];

  const { deliveredIds, failedIds } = await sendToRecipients(
    rows,
    partnerById,
    recipients,
    settings,
    keyDatesByUser
  );
  return { deliveredIds: [...deliveredIds], failedIds: [...failedIds] };
}

module.exports = {
  normalizeRecipient,
  sendToRecipients,
  sendDigestTier,
};
