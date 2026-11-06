// The actual flush logic for the batched notification queue (see #129)
// -- extracted into its own util rather than living inside
// routes/notifications.js, since both that route's manual "Send Pending
// Notifications" button and utils/digestScheduler.js's own automatic
// flush need to call the exact same logic, and routes/ in this app are
// thin HTTP handlers over utils/, never the other way around.
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { buildBlurb, REVIEW_GATED_TYPES, PUBLIC_DIGEST_TYPES } = require("./notificationBlurbs");
const { sendPendingNotificationsBatch } = require("./groupme");
const { sendPendingNotificationsDigest } = require("./emailDigest");

// A restricted partner's real-content notification (#187) is held out of
// every send path -- manual button and automatic schedule alike, both of
// which go through flushPendingNotifications() below -- until an admin
// has edited/confirmed it via PUT /api/notifications/pending/:id. Reads
// isRestricted live off the passed-in partner (already fetched fresh by
// the caller, same discipline buildBlurb's own masking follows), not a
// frozen value, since restricted status can change after a row was
// queued. Exported so utils/scopedDigest.js's own send pass (#202) holds
// a restricted partner's unreviewed row out of the public/admin scoped
// digests exactly the same way, rather than re-deriving this check.
function needsReview(row, partner) {
  return REVIEW_GATED_TYPES.has(row.type) && !!partner?.isRestricted && !row.reviewedAt;
}

// Per-row, per-tier eligibility check for the scoped digest (#202) --
// whether a given cadence tier has *anyone* who'd actually receive this
// specific row, considering its type. Not a flat per-tier boolean: a
// supportNeedCreated/newsletterCreated row is only ever relevant to the
// admin audience (the public audience is never eligible for anything
// outside PUBLIC_DIGEST_TYPES, regardless of Partner.isPublic), so a
// tier with plenty of confirmed public subscribers but zero admin ones
// is still vacuously unsatisfied-by-default for that row -- i.e.
// tierApplies returns false, which is exactly what lets it clear without
// ever having been sent to a tier nobody relevant subscribed to.
//
// counts.tierScheduled[tier] gates the whole thing on whether that
// tier's actual send schedule (ChurchSettings.scopedDigestDayOfWeek/
// DayOfMonth/Hour -- see digestScheduler.js's shouldFlushWeekly/
// Biweekly/MonthlyScopedDigest) has been configured at all -- there's no
// settings route to set those fields yet as of this phase, so without
// this guard, a row would wait forever on a tier stamp that nothing will
// ever write once any admin picks that cadence from the Account Settings
// control Phase 2 already shipped (a church could easily hit this before
// a later phase adds that schedule's own settings page). Same "not
// configured yet -- never blocks anything" reasoning shouldFlushNow
// itself already applies to the internal digest's own schedule.
function tierApplies(row, tier, partner, counts) {
  if (!counts.tierScheduled[tier]) return false;
  const hasAdminSub = (counts.adminSubscriberCountByTier[tier] || 0) > 0;
  const hasPublicSub =
    PUBLIC_DIGEST_TYPES.has(row.type) &&
    !!partner?.isPublic &&
    (counts.publicSubscriberCountByTier[tier] || 0) > 0;
  return hasAdminSub || hasPublicSub;
}

// Attempts whichever channels are currently enabled, independently --
// see the PendingNotification schema.prisma comment for the full
// per-channel-success reasoning (a channel that's off never blocks a
// row's deletion; a channel whose send failed leaves that row queued
// for the next flush without touching a channel that already
// succeeded).
async function flushPendingNotifications() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      enabledFeatures: true,
      scopedDigestDayOfWeek: true,
      scopedDigestDayOfMonth: true,
      scopedDigestHour: true,
    },
  });
  const groupmeOn = isFeatureEnabled(settings?.enabledFeatures, "groupme");
  const emailOn = isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");

  // A row can also still be outstanding against one of the three scoped-
  // digest tiers (#202) even once groupme/email are both done with it --
  // see the clearing filter below -- so this can't just be the original
  // two-channel OR. Rather than add three more OR-terms here (and risk
  // this query drifting out of sync with the clearing filter's own
  // tierApplies logic), it's simpler and cheap enough at this app's scale
  // to just read every row and let the filter below decide what's
  // actually clearable.
  const rows = await prisma.pendingNotification.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { sent: 0, remaining: 0, heldForReview: 0 };

  // Read fresh, not from each row's own frozen payload -- isRestricted
  // can change after a notification was already queued, and buildBlurb
  // needs the current value to mask correctly (see notificationBlurbs.js).
  const partners = await prisma.partner.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.partnerId))] } },
    select: { id: true, displayName: true, isRestricted: true, isPublic: true },
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  // Per-tier subscriber counts, computed once for this whole flush --
  // see tierApplies() above for how these feed the clearing filter.
  const [adminTierCounts, publicTierCounts] = await Promise.all([
    prisma.user.groupBy({
      by: ["digestFrequency"],
      where: { digestFrequency: { not: null }, active: true },
      _count: true,
    }),
    prisma.publicSubscriber.groupBy({
      by: ["frequency"],
      where: { confirmedAt: { not: null } },
      _count: true,
    }),
  ]);
  const scheduleConfigured = settings?.scopedDigestHour != null;
  const tierCounts = {
    adminSubscriberCountByTier: Object.fromEntries(adminTierCounts.map((r) => [r.digestFrequency, r._count])),
    publicSubscriberCountByTier: Object.fromEntries(publicTierCounts.map((r) => [r.frequency, r._count])),
    tierScheduled: {
      weekly: scheduleConfigured && settings.scopedDigestDayOfWeek != null,
      biweekly: scheduleConfigured && settings.scopedDigestDayOfWeek != null,
      monthly: scheduleConfigured && settings.scopedDigestDayOfMonth != null,
    },
  };

  // A restricted partner's unreviewed real-content row (#187) is held out
  // of both channels below entirely -- it simply never appears in either
  // candidates array, so it's never sent and never stamped, same as a
  // failed-send row staying queued for the next flush, just for a
  // different reason. groupme.js/emailDigest.js need no awareness of this
  // -- they only ever see whatever candidates array they're handed.
  const sendableRows = rows.filter((row) => !needsReview(row, partnerById.get(row.partnerId)));
  const heldForReview = rows.length - sendableRows.length;

  const blurbById = new Map(
    rows.map((row) => [row.id, buildBlurb(row, partnerById.get(row.partnerId))]).filter(([, blurb]) => blurb)
  );

  if (groupmeOn) {
    const candidates = sendableRows
      .filter((row) => !row.groupmeSentAt)
      .map((row) => blurbById.get(row.id))
      .filter(Boolean);
    if (candidates.length > 0) {
      const sentIds = await sendPendingNotificationsBatch(candidates);
      if (sentIds.size > 0) {
        await prisma.pendingNotification.updateMany({
          where: { id: { in: [...sentIds] } },
          data: { groupmeSentAt: new Date() },
        });
      }
    }
  }

  if (emailOn) {
    const candidates = sendableRows
      .filter((row) => !row.emailSentAt)
      .map((row) => blurbById.get(row.id))
      .filter(Boolean);
    if (candidates.length > 0) {
      const ran = await sendPendingNotificationsDigest(candidates);
      if (ran) {
        await prisma.pendingNotification.updateMany({
          where: { id: { in: candidates.map((blurb) => blurb.id) } },
          data: { emailSentAt: new Date() },
        });
      }
    }
  }

  // Re-read current sent-state (the updateMany calls above already wrote
  // it; the three scoped-digest tier stamps are written separately by
  // utils/scopedDigest.js's own send pass, called from the scheduler's
  // three tier gate-checks, not from here -- see tierApplies() above and
  // digestScheduler.js's checkAndMaybeFlush()) to decide what's now fully
  // cleared.
  const refreshed = await prisma.pendingNotification.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: {
      id: true,
      type: true,
      partnerId: true,
      groupmeSentAt: true,
      emailSentAt: true,
      weeklyDigestSentAt: true,
      biweeklyDigestSentAt: true,
      monthlyDigestSentAt: true,
    },
  });
  // Guards against the vacuous case where nothing could ever have been
  // sent anywhere for a given row: without the leading check, every
  // "!channelApplies" half below is trivially true for a channel/tier
  // that's off/has nobody subscribed, and the row would get deleted
  // having never actually reached anyone. This has to be computed per
  // row, not once for the whole flush, because whether a given tier
  // "applies" depends on the row's own type (see tierApplies() above).
  const clearableIds = refreshed
    .filter((row) => {
      const partner = partnerById.get(row.partnerId);
      const weeklyApplies = tierApplies(row, "weekly", partner, tierCounts);
      const biweeklyApplies = tierApplies(row, "biweekly", partner, tierCounts);
      const monthlyApplies = tierApplies(row, "monthly", partner, tierCounts);
      if (!(groupmeOn || emailOn || weeklyApplies || biweeklyApplies || monthlyApplies)) return false;
      return (
        (!groupmeOn || row.groupmeSentAt) &&
        (!emailOn || row.emailSentAt) &&
        (!weeklyApplies || row.weeklyDigestSentAt) &&
        (!biweeklyApplies || row.biweeklyDigestSentAt) &&
        (!monthlyApplies || row.monthlyDigestSentAt)
      );
    })
    .map((row) => row.id);
  if (clearableIds.length > 0) {
    await prisma.pendingNotification.deleteMany({ where: { id: { in: clearableIds } } });
  }

  return { sent: clearableIds.length, remaining: rows.length - clearableIds.length, heldForReview };
}

module.exports = { flushPendingNotifications, needsReview, tierApplies };
