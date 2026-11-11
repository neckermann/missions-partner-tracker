// Two cross-channel operations that don't belong to any single
// channel's file: clearDispatchRecords() (deleting a row needs every
// channel's state at once) and sendUrgentDispatch() (an immediate,
// cadence-bypassing send across all four channels for one row).
//
// One-way dependency on groupmeChannel.js/emailDispatchDelivery.js, never the
// reverse -- emailDispatchScheduler.js composes "run a pass, then clear" for
// both triggers, so neither pass's file needs to call back into this one.
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { CHANNELS, isEligibleForChannel, needsReview, getChurchSettings } = require("./dispatchEligibility");
const { postToGroupMe } = require("./groupmeChannel");
const { postToWhatsApp, hasWhatsAppTarget } = require("./whatsappChannel");
const whatsappClient = require("./whatsappClient");
const { normalizeRecipient, sendToRecipients } = require("./emailDispatchDelivery");

const TIERS = ["biweekly", "monthly", "quarterly"];
const TIER_STAMP_COLUMN = {
  biweekly: "biweeklyEmailDispatchSentAt",
  monthly: "monthlyEmailDispatchSentAt",
  quarterly: "quarterlyEmailDispatchSentAt",
};

// Reads every row's current stamp columns across all channels and
// deletes whatever is now fully resolved. A toggle/feature being off
// counts as *permanent* for that channel here, not "could still change"
// -- re-enabling it later only affects events recorded after that
// point. The one universal exception: needsReview blocks every channel
// at once, so a restricted-and-unreviewed row never clears regardless
// of toggle state.
async function clearDispatchRecords() {
  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { cleared: 0 };

  const settings = await getChurchSettings();
  const partners = await prisma.partner.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
    select: { id: true, isRestricted: true, isPublic: true },
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const groupmeOn = isFeatureEnabled(settings?.enabledFeatures, "groupme");
  const whatsappOn = isFeatureEnabled(settings?.enabledFeatures, "whatsapp");
  const emailOn = isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");
  const publicDigestOn = isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");

  // Per-tier subscriber counts, computed once -- a tier "applies" to a
  // row depends on both its type (Rule 2) and whether anyone's
  // currently subscribed on that tier.
  const [adminTierCounts, publicTierCounts] = await Promise.all([
    prisma.user.groupBy({ by: ["cadence"], where: { cadence: { not: null }, active: true }, _count: true }),
    prisma.publicSubscriber.groupBy({ by: ["cadence"], where: { confirmedAt: { not: null } }, _count: true }),
  ]);
  const adminCountByTier = Object.fromEntries(adminTierCounts.map((r) => [r.cadence, r._count]));
  const publicCountByTier = Object.fromEntries(publicTierCounts.map((r) => [r.cadence, r._count]));
  const tierScheduled = {
    biweekly: settings?.emailDispatchHour != null && settings?.emailDispatchDayOfWeek != null,
    monthly: settings?.emailDispatchHour != null && settings?.emailDispatchDayOfMonth != null,
    quarterly: settings?.emailDispatchHour != null && settings?.emailDispatchDayOfMonth != null,
  };

  function tierApplies(row, tier, partner) {
    if (!emailOn || !tierScheduled[tier]) return false;
    const hasAdminSub =
      (adminCountByTier[tier] || 0) > 0 &&
      isEligibleForChannel(row, CHANNELS.EMAIL_ADMIN, partner, settings, true);
    const hasPublicSub =
      publicDigestOn &&
      (publicCountByTier[tier] || 0) > 0 &&
      isEligibleForChannel(row, CHANNELS.EMAIL_PUBLIC, partner, settings, true);
    return hasAdminSub || hasPublicSub;
  }

  const clearableIds = rows
    .filter((row) => {
      const partner = partnerById.get(row.partnerId);
      if (needsReview(row, partner)) return false;

      const groupmeApplies =
        groupmeOn && isEligibleForChannel(row, CHANNELS.GROUPME, partner, settings, true);
      // WhatsApp only "applies" once this row's type resolves to some
      // group -- its own pick or the community's Announcements fallback
      // (see whatsappChannel.js's hasWhatsAppTarget) -- otherwise the
      // row would wait forever for a channel that can never take it.
      // Deliberately not gated on live pairing state here -- see
      // hasWhatsAppTarget's own comment on why that would wrongly treat
      // a momentary reconnect the same as a permanent "off."
      const whatsappApplies =
        whatsappOn &&
        hasWhatsAppTarget(row, settings) &&
        isEligibleForChannel(row, CHANNELS.WHATSAPP, partner, settings, true);
      const tiers = Object.fromEntries(TIERS.map((tier) => [tier, tierApplies(row, tier, partner)]));

      // Guards the vacuous case: with every channel off/unsubscribed,
      // every "!applies" term below is trivially true, which would
      // delete a row that never actually reached anyone.
      if (!(groupmeApplies || whatsappApplies || Object.values(tiers).some(Boolean))) return false;

      return (
        (!groupmeApplies || row.groupmeDispatchedAt) &&
        (!whatsappApplies || row.whatsappDispatchedAt) &&
        TIERS.every((tier) => !tiers[tier] || row[TIER_STAMP_COLUMN[tier]])
      );
    })
    .map((row) => row.id);

  if (clearableIds.length > 0) {
    await prisma.dispatchRecord.deleteMany({ where: { id: { in: clearableIds } } });
  }

  return { cleared: clearableIds.length, remaining: rows.length - clearableIds.length };
}

// How many admins and confirmed public subscribers would be notified
// about this partner right now, cadence-blind -- populates the confirm
// dialog's numbers before an urgent send fires. Approximate on purpose
// (scoped by partner only, not the row's exact type/settings) -- the
// dialog's job is to convey real scale, not predict eligibility
// exactly. Both counts are 0 when outboundEmail is off, matching
// sendUrgentDispatch()'s own gating, so these numbers never overstate
// what will actually happen.
async function countUrgentRecipients(partnerId) {
  const settings = await getChurchSettings();
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
    return { adminCount: 0, publicCount: 0 };
  }
  const publicDigestOn = isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");
  const [adminCount, publicCount] = await Promise.all([
    prisma.user.count({
      where: { active: true, OR: [{ allPartners: true }, { followedPartners: { some: { partnerId } } }] },
    }),
    publicDigestOn
      ? prisma.publicSubscriber.count({
          where: {
            confirmedAt: { not: null },
            OR: [{ allPartners: true }, { scopedPartners: { some: { partnerId } } }],
          },
        })
      : 0,
  ]);
  return { adminCount, publicCount };
}

// The two chat-channel branches of sendUrgentDispatch below, split out
// so they can run concurrently (Promise.all) rather than one after the
// other -- they're already fully independent (separate settings gate,
// separate dispatchedAt column), so there's no reason an urgent send
// should pay the sum of GroupMe's HTTP round trip and WhatsApp's
// anti-ban-delayed socket send instead of the max of the two. Each one
// also now catches its own failure: previously neither call had a
// try/catch at all, so a GroupMe error (a revoked token, a network
// blip) would throw out of sendUrgentDispatch entirely and silently
// skip WhatsApp and email too -- exactly the "a provider failure must
// not block the other" guarantee #242's own acceptance criteria call
// for, which this function wasn't actually providing.
async function sendGroupMeUrgent(row, partner, partnerById, settings, now) {
  if (
    !isFeatureEnabled(settings?.enabledFeatures, "groupme") ||
    !isEligibleForChannel(row, CHANNELS.GROUPME, partner, settings, true)
  ) {
    return false;
  }
  try {
    const sentIds = await postToGroupMe([row], partnerById, settings);
    const posted = sentIds.has(row.id);
    if (posted) {
      await prisma.dispatchRecord.update({ where: { id: row.id }, data: { groupmeDispatchedAt: now } });
    }
    return posted;
  } catch (err) {
    console.error("Urgent GroupMe send failed:", err.message);
    return false;
  }
}

async function sendWhatsAppUrgent(row, partner, partnerById, settings, now) {
  if (
    !isFeatureEnabled(settings?.enabledFeatures, "whatsapp") ||
    !hasWhatsAppTarget(row, settings) ||
    !isEligibleForChannel(row, CHANNELS.WHATSAPP, partner, settings, true) ||
    whatsappClient.getStatus().status !== "connected"
  ) {
    return false;
  }
  try {
    const sentIds = await postToWhatsApp([row], partnerById, settings);
    const posted = sentIds.has(row.id);
    if (posted) {
      await prisma.dispatchRecord.update({ where: { id: row.id }, data: { whatsappDispatchedAt: now } });
    }
    return posted;
  } catch (err) {
    console.error("Urgent WhatsApp send failed:", err.message);
    return false;
  }
}

// Immediate, cadence-bypassing send for one row, across all four
// channels -- still calls isEligibleForChannel per channel like every
// scheduled pass; only Rule 3's cadence-tier matching is bypassed (a
// cadence-blind recipient query instead). Rules 1 and 2 run unchanged:
// a restricted-and-unreviewed row still never sends, a muted chat-channel
// content-type still suppresses an urgent post, an urgent one-time need
// still never reaches the public email dispatch.
//
// Re-fetches isRestricted/isPublic fresh by id rather than trusting the
// caller's partner shape -- dispatchRecording.js only has a route's
// partnerRefSelect on hand ({ id, kind, displayName }), not these two
// safety-critical fields.
async function sendUrgentDispatch(row, { id: partnerId }) {
  const [settings, partner] = await Promise.all([
    getChurchSettings(),
    prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, isRestricted: true, isPublic: true },
    }),
  ]);
  const partnerById = new Map([[partner.id, partner]]);
  const now = new Date();

  const [groupmePosted, whatsappPosted] = await Promise.all([
    sendGroupMeUrgent(row, partner, partnerById, settings, now),
    sendWhatsAppUrgent(row, partner, partnerById, settings, now),
  ]);

  // Cadence-blind: every active admin and confirmed public subscriber,
  // regardless of tier or whether that tier's schedule fired today --
  // reuses emailDispatchDelivery.js's recipient-normalization and send/chunking,
  // just fed an unfiltered recipient query. sendToRecipients has no
  // awareness of feature flags, so this call site gates outboundEmail/
  // publicPrayerDigest itself, the same two gates the scheduled path
  // checks before ever calling it -- otherwise an urgent send would
  // keep emailing with either feature turned off.
  const emailOn = isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");
  const publicDigestOn = isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");
  let admins = [];
  let publicSubscribers = [];
  let emailSent = false;
  if (emailOn) {
    [admins, publicSubscribers] = await Promise.all([
      prisma.user.findMany({
        where: { active: true },
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
            where: { confirmedAt: { not: null } },
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
    const consideredIds = await sendToRecipients([row], partnerById, recipients, settings);
    emailSent = consideredIds.has(row.id);

    if (emailSent) {
      await prisma.dispatchRecord.update({
        where: { id: row.id },
        data: {
          biweeklyEmailDispatchSentAt: now,
          monthlyEmailDispatchSentAt: now,
          quarterlyEmailDispatchSentAt: now,
        },
      });
    }
  }

  return {
    groupmePosted,
    whatsappPosted,
    emailSent,
    adminCount: admins.length,
    publicCount: publicSubscribers.length,
  };
}

module.exports = { clearDispatchRecords, countUrgentRecipients, sendUrgentDispatch };
