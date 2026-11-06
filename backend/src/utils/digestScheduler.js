// In-process scheduler for both independent triggers: the admin/public
// email digest's three cadence tiers, and GroupMe's own daily-hour
// schedule. Runs inside this app's own single web service instance --
// no Render Cron Job resource, no separate process -- confirmed safe at
// this app's actual scale: render.yaml provisions exactly one web
// service (no horizontal scaling today), so there's no multi-instance
// double-fire risk to guard against yet. If this app is ever scaled to
// 2+ instances, node-cron's own `distributed: true` option (env-var
// flag out of the box, a Redis coordinator for real HA) is the fix --
// not built now since it isn't needed yet.
//
// Two independent registrations below, even though both happen to tick
// every minute -- they check entirely different schedule fields and
// must stay independent if either one's cadence ever changes without
// touching the other. Both call clearNotifiableEvents() at the end of
// their own run: either trigger can be the one that finally makes a row
// clearable, and clearNotifiableEvents() doesn't care which pass just
// ran, it only reads whatever stamp state exists right now. Neither
// trigger calls the other; notificationOrchestrator.js doesn't call
// either pass either -- this file is the one place that composes
// "run a pass, then see what can clear" for both.
//
// "Server-local hour/day" below reads via plain Date getters (getDay(),
// getHours()), which depend on process.env.TZ actually matching this
// church's real local time -- see server.js's startup read of
// ChurchSettings.timezone and that field's own schema.prisma comment.
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { sendDigestTier } = require("./digestDelivery");
const { runGroupMePass } = require("./groupmeChannel");
const { clearNotifiableEvents } = require("./notificationOrchestrator");

// Biweekly shares scopedDigestDayOfWeek; only the minimum gap below
// tells it apart from a plain weekly check (which doesn't exist as a
// tier anymore, but the same "only the gap tells cycles apart" trick
// still applies between biweekly's own two-week cycle and any
// mis-timed extra tick). Monthly and quarterly share
// scopedDigestDayOfMonth the same way. Approximate day counts, not
// exact -- a few hours either way doesn't matter at this granularity.
const MIN_GAP_MS = {
  biweekly: 13 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000,
  quarterly: 85 * 24 * 60 * 60 * 1000,
};

// Pure (no I/O, no Date.now()) so it's directly unit-testable with a
// fixed `now`, independent of the host machine's actual timezone -- see
// test/digestScheduler.test.js.
function shouldFlushBiweeklyScopedDigest(settings, now) {
  if (settings?.scopedDigestDayOfWeek == null || settings?.scopedDigestHour == null) return false; // not configured yet
  if (now.getDay() !== settings.scopedDigestDayOfWeek || now.getHours() !== settings.scopedDigestHour)
    return false;
  const sinceLast = settings.lastBiweeklyScopedDigestSentAt
    ? now - settings.lastBiweeklyScopedDigestSentAt
    : Infinity;
  return sinceLast >= MIN_GAP_MS.biweekly;
}

function shouldFlushMonthlyScopedDigest(settings, now) {
  if (settings?.scopedDigestDayOfMonth == null || settings?.scopedDigestHour == null) return false; // not configured yet
  if (now.getDate() !== settings.scopedDigestDayOfMonth || now.getHours() !== settings.scopedDigestHour) {
    return false;
  }
  const sinceLast = settings.lastMonthlyScopedDigestSentAt
    ? now - settings.lastMonthlyScopedDigestSentAt
    : Infinity;
  return sinceLast >= MIN_GAP_MS.monthly;
}

function shouldFlushQuarterlyScopedDigest(settings, now) {
  if (settings?.scopedDigestDayOfMonth == null || settings?.scopedDigestHour == null) return false; // not configured yet
  if (now.getDate() !== settings.scopedDigestDayOfMonth || now.getHours() !== settings.scopedDigestHour) {
    return false;
  }
  const sinceLast = settings.lastQuarterlyScopedDigestSentAt
    ? now - settings.lastQuarterlyScopedDigestSentAt
    : Infinity;
  return sinceLast >= MIN_GAP_MS.quarterly;
}

// Stamps `column` on every row `ids` names with `now`, then updates
// ChurchSettings' matching last-sent cursor -- shared by all three tier
// blocks in checkAndMaybeFlushDigest below since they're otherwise
// identical aside from which gate/column/cursor they use.
async function runDigestTier(tier, column, cursorField, settings, now) {
  const { consideredIds } = await sendDigestTier(tier, settings);
  if (consideredIds.length > 0) {
    await prisma.notifiableEvent.updateMany({
      where: { id: { in: consideredIds } },
      data: { [column]: now },
    });
  }
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { [cursorField]: now } });
}

async function checkAndMaybeFlushDigest() {
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const now = new Date();

    if (shouldFlushBiweeklyScopedDigest(settings, now)) {
      await runDigestTier(
        "biweekly",
        "biweeklyDigestSentAt",
        "lastBiweeklyScopedDigestSentAt",
        settings,
        now
      );
    }
    if (shouldFlushMonthlyScopedDigest(settings, now)) {
      await runDigestTier("monthly", "monthlyDigestSentAt", "lastMonthlyScopedDigestSentAt", settings, now);
    }
    if (shouldFlushQuarterlyScopedDigest(settings, now)) {
      await runDigestTier(
        "quarterly",
        "quarterlyDigestSentAt",
        "lastQuarterlyScopedDigestSentAt",
        settings,
        now
      );
    }

    await clearNotifiableEvents();
  } catch (err) {
    // A failed check must never crash the scheduler itself -- it just
    // tries again next minute.
    console.error("Digest schedule check failed:", err);
  }
}

async function checkAndMaybeFlushGroupMe() {
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const now = new Date();
    await runGroupMePass(settings, now);
    await clearNotifiableEvents();
  } catch (err) {
    console.error("GroupMe schedule check failed:", err);
  }
}

// Called once from server.js at startup. Always registered regardless
// of whether a schedule is configured yet (both checks no-op
// immediately if not) -- so a schedule an admin sets or changes later
// takes effect on its very next matching minute, not just at the next
// server restart. noOverlap: true skips a tick if the previous one is
// still running, rather than stacking concurrent flushes.
function startDigestScheduler() {
  cron.schedule("* * * * *", checkAndMaybeFlushDigest, { name: "email-digest", noOverlap: true });
}

function startGroupMeScheduler() {
  cron.schedule("* * * * *", checkAndMaybeFlushGroupMe, { name: "groupme-digest", noOverlap: true });
}

module.exports = {
  startDigestScheduler,
  startGroupMeScheduler,
  checkAndMaybeFlushDigest,
  checkAndMaybeFlushGroupMe,
  shouldFlushBiweeklyScopedDigest,
  shouldFlushMonthlyScopedDigest,
  shouldFlushQuarterlyScopedDigest,
};
