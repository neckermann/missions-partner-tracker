// Cross-channel operations that belong to no single channel: clearDispatchRecords()
// (deleting a row needs every channel's state) and sendUrgentDispatch() (an
// immediate, cadence-bypassing send across all four channels for one row).
// One-way dependency on groupmeChannel.js/emailDispatchDelivery.js, never the reverse.
const prisma = require("../prismaClient");
const { DIGEST_RECIPIENT_ROLES } = require("./digestRoles");
const { resolveDigestScope, digestCovers } = require("./digestScope");
const { isFeatureEnabled } = require("./features");
const { CHANNELS, isEligibleForChannel, needsReview, getChurchSettings } = require("./dispatchEligibility");
const { isEverydayPrayer } = require("./dispatchBlurbs");
const { postToGroupMe } = require("./groupmeChannel");
const { postToWhatsApp, hasWhatsAppTarget } = require("./whatsappChannel");
const whatsappClient = require("./whatsappClient");
const { normalizeRecipient, sendToRecipients } = require("./emailDispatchDelivery");

// Unsent rows no channel applies to are deleted after this long.
const UNSENT_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;

const TIERS = ["biweekly", "monthly", "quarterly"];
const TIER_STAMP_COLUMN = {
  biweekly: "biweeklyEmailDispatchSentAt",
  monthly: "monthlyEmailDispatchSentAt",
  quarterly: "quarterlyEmailDispatchSentAt",
};

// Reads every row's stamp columns across all channels and deletes whatever is
// fully resolved. A toggle/feature being off counts as *permanent* for that
// channel (re-enabling only affects later events). Exception: needsReview blocks
// every channel, so a restricted-and-unreviewed row never clears.
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

  // Per-tier subscriber counts, computed once: a tier applies depending on the row's type (Rule 2) and whether anyone is subscribed.
  const [adminTierCounts, publicTierCounts] = await Promise.all([
    prisma.user.groupBy({
      by: ["cadence"],
      where: { cadence: { not: null }, active: true, role: { in: DIGEST_RECIPIENT_ROLES } },
      _count: true,
    }),
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
      // Never sendable, so nothing is waiting on it: drop it now rather than after the grace period.
      if (isEverydayPrayer(row)) return true;
      const partner = partnerById.get(row.partnerId);
      if (needsReview(row, partner)) return false;

      const groupmeApplies =
        groupmeOn && isEligibleForChannel(row, CHANNELS.GROUPME, partner, settings, true);
      // WhatsApp "applies" once this row's type resolves to some group (own pick
      // or Announcements fallback), else the row would wait forever. Not gated on
      // live pairing; see hasWhatsAppTarget.
      const whatsappApplies =
        whatsappOn &&
        hasWhatsAppTarget(row, settings) &&
        isEligibleForChannel(row, CHANNELS.WHATSAPP, partner, settings, true);
      const tiers = Object.fromEntries(TIERS.map((tier) => [tier, tierApplies(row, tier, partner)]));

      // The vacuous case: with nothing applying, every "!applies" term is trivially true, so the
      // row cannot be judged "fully sent". Keep it for a grace period (a channel may be switched
      // on soon), then drop it so it can't pile up and post all at once much later.
      if (!(groupmeApplies || whatsappApplies || Object.values(tiers).some(Boolean))) {
        return row.createdAt < new Date(Date.now() - UNSENT_EXPIRY_MS);
      }

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

// How many admins and confirmed public subscribers would be notified about this
// partner now, cadence-blind, for the urgent-send confirm dialog. Approximate on
// purpose (scoped by partner only). Both are 0 when outboundEmail is off, matching
// sendUrgentDispatch(), so the numbers never overstate.
// Active logins whose digest scope covers this partner (all, followed, or looked after; a guest only for
// partners they hold a seat on).
async function countAdminsCovering(partnerId) {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: DIGEST_RECIPIENT_ROLES } },
    select: { id: true, role: true, digestScope: true, followedPartners: { select: { partnerId: true } } },
  });
  const covered = await Promise.all(users.map((u) => digestCovers(u, partnerId)));
  return covered.filter(Boolean).length;
}

async function countUrgentRecipients(partnerId) {
  const settings = await getChurchSettings();
  if (!isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
    return { adminCount: 0, publicCount: 0 };
  }
  const publicDigestOn = isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");
  const [adminCount, publicCount] = await Promise.all([
    countAdminsCovering(partnerId),
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

// The two chat-channel branches of sendUrgentDispatch, run concurrently since
// they are independent. Each catches its own failure so a GroupMe error (revoked
// token, network blip) can't skip WhatsApp and email: a provider failure must not block the others.
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
      await prisma.dispatchRecord.update({
        where: { id: row.id },
        data: { groupmeDispatchedAt: now, groupmeError: null },
      });
    }
    return posted;
  } catch (err) {
    console.error("Urgent GroupMe send failed:", err.message);
    await prisma.dispatchRecord.update({ where: { id: row.id }, data: { groupmeError: err.message } });
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
      await prisma.dispatchRecord.update({
        where: { id: row.id },
        data: { whatsappDispatchedAt: now, whatsappError: null },
      });
    }
    return posted;
  } catch (err) {
    console.error("Urgent WhatsApp send failed:", err.message);
    await prisma.dispatchRecord.update({ where: { id: row.id }, data: { whatsappError: err.message } });
    return false;
  }
}

// Immediate send for one row across all four channels. Still calls
// isEligibleForChannel per channel; only Rule 3's cadence-tier matching is
// bypassed. Rules 1 and 2 hold: a restricted-and-unreviewed row never sends, a
// muted chat content type still suppresses, an urgent one-time need never
// reaches the public email dispatch.
//
// Re-fetches isRestricted/isPublic by id rather than trusting the caller's
// partner shape, which lacks these safety-critical fields.
async function sendUrgentDispatch(row, { id: partnerId }) {
  // Belt and braces: every channel below refuses it too (dispatchEligibility.js Rule 0).
  if (isEverydayPrayer(row)) {
    return { groupmePosted: false, whatsappPosted: false, emailSent: false, adminCount: 0, publicCount: 0 };
  }
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

  // Every active admin and confirmed public subscriber regardless of tier,
  // reusing emailDispatchDelivery.js's normalization and chunking. sendToRecipients
  // ignores feature flags, so this call site gates outboundEmail/publicPrayerDigest
  // itself, like the scheduled path.
  const emailOn = isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");
  const publicDigestOn = isFeatureEnabled(settings?.enabledFeatures, "publicPrayerDigest");
  let admins = [];
  let publicSubscribers = [];
  let emailSent = false;
  if (emailOn) {
    [admins, publicSubscribers] = await Promise.all([
      prisma.user.findMany({
        // A guest only through the partners they hold a seat on (digestScope is forced to "owned").
        where: { active: true, role: { in: DIGEST_RECIPIENT_ROLES } },
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
    const adminRecipients = await Promise.all(
      admins.map(async (u) => normalizeRecipient(u, CHANNELS.EMAIL_ADMIN, await resolveDigestScope(u)))
    );
    const recipients = [
      ...adminRecipients,
      ...publicSubscribers.map((s) => normalizeRecipient(s, CHANNELS.EMAIL_PUBLIC)),
    ];
    const { deliveredIds, failedIds } = await sendToRecipients([row], partnerById, recipients, settings);
    emailSent = deliveredIds.has(row.id);

    // Only a row that reached someone is stamped as sent (a failed send leaves it for the next scheduled
    // digest), and its error note is kept if any recipient's send failed.
    if (emailSent) {
      await prisma.dispatchRecord.update({
        where: { id: row.id },
        data: {
          biweeklyEmailDispatchSentAt: now,
          monthlyEmailDispatchSentAt: now,
          quarterlyEmailDispatchSentAt: now,
          ...(failedIds.has(row.id) ? {} : { emailError: null }),
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
