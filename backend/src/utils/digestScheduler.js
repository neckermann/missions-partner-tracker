// In-process scheduler for the batched notification digest (see #129).
// Runs inside this app's own single web service instance -- no Render
// Cron Job resource, no separate process -- confirmed safe at this
// app's actual scale: render.yaml provisions exactly one web service
// (no horizontal scaling today), so there's no multi-instance
// double-fire risk to guard against yet. If this app is ever scaled to
// 2+ instances, node-cron's own `distributed: true` option (env-var
// flag out of the box, a Redis coordinator for real HA) is the fix --
// not built now since it isn't needed yet.
//
// "Server-local hour/day" below reads via plain Date getters (getDay(),
// getHours()), the exact same convention every other date-sensitive
// feature in this app already relies on (birthdays, furlough windows,
// etc. -- see .github/workflows/ci.yml's own TZ comment) -- this app
// assumes process.env.TZ is set to the church's own timezone, not UTC,
// same assumption here, nothing new introduced.
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { flushPendingNotifications } = require("./notificationFlush");
const { sendScopedDigest } = require("./scopedDigest");

// Weekly/biweekly share digestDayOfWeek; only the minimum gap below is
// what actually tells them apart (see the ChurchSettings schema
// comment). Approximate day counts, not exact -- a few hours either way
// doesn't matter at weekly-or-coarser granularity.
const MIN_GAP_MS = {
  weekly: 6 * 24 * 60 * 60 * 1000,
  biweekly: 13 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000,
};

// Pure (no I/O, no Date.now()) so it's directly unit-testable with a
// fixed `now` -- see test/digestScheduler.test.js. Takes the same
// settings shape the ChurchSettings select below reads.
function shouldFlushNow(settings, now) {
  if (!settings?.digestFrequency) return false; // no schedule configured -- manual Send only

  const dayMatches =
    settings.digestFrequency === "monthly"
      ? now.getDate() === settings.digestDayOfMonth
      : now.getDay() === settings.digestDayOfWeek;
  const hourMatches = now.getHours() === settings.digestHour;
  if (!dayMatches || !hourMatches) return false;

  const minGap = MIN_GAP_MS[settings.digestFrequency];
  const sinceLast = settings.lastDigestSentAt ? now - settings.lastDigestSentAt : Infinity;
  return sinceLast >= minGap; // false = already sent this cycle (or within the same matching hour)
}

// Three more pure gate-checks (#202), one per scoped-digest cadence
// tier, mirroring shouldFlushNow's own day/hour-matching logic exactly
// (including its biweekly handling: weekly/biweekly share
// scopedDigestDayOfWeek, telling them apart purely via MIN_GAP_MS) but
// against the scopedDigest* fields instead -- genuinely independent of
// the internal digest's own schedule above, so a church can run these on
// different days/hours. Not a new cron registration: these are called
// alongside shouldFlushNow from the same existing per-minute tick below.
function shouldFlushWeeklyScopedDigest(settings, now) {
  if (settings?.scopedDigestDayOfWeek == null || settings?.scopedDigestHour == null) return false; // not configured yet
  if (now.getDay() !== settings.scopedDigestDayOfWeek || now.getHours() !== settings.scopedDigestHour)
    return false;
  const sinceLast = settings.lastWeeklyScopedDigestSentAt
    ? now - settings.lastWeeklyScopedDigestSentAt
    : Infinity;
  return sinceLast >= MIN_GAP_MS.weekly;
}

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

// Stamps `column` on every row `ids` names with `now`, then updates
// ChurchSettings' matching last-sent cursor -- shared by all three tier
// blocks in checkAndMaybeFlush below since they're otherwise identical
// aside from which gate/column/cursor they use.
async function runScopedDigestTier(tier, column, cursorField, settings, now) {
  const { consideredIds } = await sendScopedDigest(tier, settings);
  if (consideredIds.length > 0) {
    await prisma.pendingNotification.updateMany({
      where: { id: { in: consideredIds } },
      data: { [column]: now },
    });
  }
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { [cursorField]: now } });
}

async function checkAndMaybeFlush() {
  try {
    // Fetched without a narrow `select` -- shouldFlushNow/the three
    // scoped-digest gates below only read a handful of fields each, but
    // sendScopedDigest() also needs this same settings object in full
    // (enabledFeatures, branding, etc.) for its own outboundEmail check
    // and for rendering, so one full fetch covers every use below rather
    // than each needing its own separate query.
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });

    const now = new Date();

    if (shouldFlushNow(settings, now)) {
      await flushPendingNotifications();
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { lastDigestSentAt: now } });
    }

    // Each of these three is fully independent of the internal digest
    // above and of each other -- all three can fire on their own
    // day/hour, all still within this same per-minute tick.
    if (shouldFlushWeeklyScopedDigest(settings, now)) {
      await runScopedDigestTier(
        "weekly",
        "weeklyDigestSentAt",
        "lastWeeklyScopedDigestSentAt",
        settings,
        now
      );
    }
    if (shouldFlushBiweeklyScopedDigest(settings, now)) {
      await runScopedDigestTier(
        "biweekly",
        "biweeklyDigestSentAt",
        "lastBiweeklyScopedDigestSentAt",
        settings,
        now
      );
    }
    if (shouldFlushMonthlyScopedDigest(settings, now)) {
      await runScopedDigestTier(
        "monthly",
        "monthlyDigestSentAt",
        "lastMonthlyScopedDigestSentAt",
        settings,
        now
      );
    }
  } catch (err) {
    // A failed check must never crash the scheduler itself -- it just
    // tries again next minute.
    console.error("Notification digest scheduler check failed:", err);
  }
}

// Called once from server.js at startup. Always registered regardless
// of whether a schedule is configured yet (checkAndMaybeFlush no-ops
// immediately if not) -- so a schedule an admin sets or changes later
// takes effect on its very next matching minute, not just at the next
// server restart. noOverlap: true skips a tick if the previous one
// (the flush itself, which makes real network calls) is still running,
// rather than stacking concurrent flushes.
function startDigestScheduler() {
  cron.schedule("* * * * *", checkAndMaybeFlush, { name: "notification-digest", noOverlap: true });
}

module.exports = {
  startDigestScheduler,
  checkAndMaybeFlush,
  shouldFlushNow,
  shouldFlushWeeklyScopedDigest,
  shouldFlushBiweeklyScopedDigest,
  shouldFlushMonthlyScopedDigest,
};
