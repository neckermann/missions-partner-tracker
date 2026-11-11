// In-process scheduler for both independent triggers: the admin/public
// email dispatch's three cadence tiers, and GroupMe/WhatsApp's own
// daily-hour chat schedule. Runs inside this app's single web service
// instance -- no Render Cron Job, no separate process -- safe at this
// app's scale (render.yaml provisions exactly one instance, no
// horizontal scaling, so no multi-instance double-fire risk yet). If
// ever scaled to 2+ instances, node-cron's `distributed: true` option
// is the fix, not built now since it isn't needed yet.
//
// Two independent registrations below, even though both tick every
// minute -- they check entirely different schedule fields and must
// stay independent if either cadence changes without touching the
// other. Both call clearDispatchRecords() at the end of their own run:
// either trigger can be what finally makes a row clearable, and that
// function doesn't care which pass just ran. Neither trigger calls the
// other, and dispatchOrchestrator.js calls neither -- this file is
// the one place composing "run a pass, then see what can clear."
//
// Hour/day checks below read via plain Date getters (getDay(),
// getHours()), which depend on process.env.TZ matching this church's
// real local time -- see server.js's startup read of
// ChurchSettings.timezone.
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { sendDigestTier } = require("./emailDispatchDelivery");
const { runGroupMePass } = require("./groupmeChannel");
const { runWhatsAppPass } = require("./whatsappChannel");
const whatsappClient = require("./whatsappClient");
const { isFeatureEnabled } = require("./features");
const { clearDispatchRecords } = require("./dispatchOrchestrator");

// Bounds how long one tick waits on whatsappClient.syncWithSettings
// below. That call can block on a real Postgres round trip (the
// advisory lock) or the Baileys handshake, and this cron job runs with
// noOverlap: true -- an unbounded hang there would silently skip every
// future tick (GroupMe sends, clearDispatchRecords) for every church
// on the instance, not just the one with WhatsApp trouble. Racing a
// timeout here doesn't cancel the underlying connect() attempt -- it
// keeps running in the background and updates whatsappClient's own
// module state normally when it finishes -- it only stops THIS tick
// from waiting on it.
const WHATSAPP_SYNC_TIMEOUT_MS = 15 * 1000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

// Biweekly shares emailDispatchDayOfWeek; only the minimum gap below
// tells it apart from a plain weekly check (which doesn't exist as a
// tier anymore, but the same "only the gap tells cycles apart" trick
// still applies between biweekly's own two-week cycle and any
// mis-timed extra tick). Monthly and quarterly share
// emailDispatchDayOfMonth the same way. Approximate day counts, not
// exact -- a few hours either way doesn't matter at this granularity.
const MIN_GAP_MS = {
  biweekly: 13 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000,
  quarterly: 85 * 24 * 60 * 60 * 1000,
};

// Pure (no I/O, no Date.now()) so it's directly unit-testable with a
// fixed `now`, independent of the host machine's actual timezone -- see
// test/emailDispatchScheduler.test.js.
function shouldFlushBiweeklyEmailDispatch(settings, now) {
  if (settings?.emailDispatchDayOfWeek == null || settings?.emailDispatchHour == null) return false; // not configured yet
  if (now.getDay() !== settings.emailDispatchDayOfWeek || now.getHours() !== settings.emailDispatchHour)
    return false;
  const sinceLast = settings.lastBiweeklyEmailDispatchSentAt
    ? now - settings.lastBiweeklyEmailDispatchSentAt
    : Infinity;
  return sinceLast >= MIN_GAP_MS.biweekly;
}

function shouldFlushMonthlyEmailDispatch(settings, now) {
  if (settings?.emailDispatchDayOfMonth == null || settings?.emailDispatchHour == null) return false; // not configured yet
  if (now.getDate() !== settings.emailDispatchDayOfMonth || now.getHours() !== settings.emailDispatchHour) {
    return false;
  }
  const sinceLast = settings.lastMonthlyEmailDispatchSentAt
    ? now - settings.lastMonthlyEmailDispatchSentAt
    : Infinity;
  return sinceLast >= MIN_GAP_MS.monthly;
}

function shouldFlushQuarterlyEmailDispatch(settings, now) {
  if (settings?.emailDispatchDayOfMonth == null || settings?.emailDispatchHour == null) return false; // not configured yet
  if (now.getDate() !== settings.emailDispatchDayOfMonth || now.getHours() !== settings.emailDispatchHour) {
    return false;
  }
  const sinceLast = settings.lastQuarterlyEmailDispatchSentAt
    ? now - settings.lastQuarterlyEmailDispatchSentAt
    : Infinity;
  return sinceLast >= MIN_GAP_MS.quarterly;
}

// Stamps `column` on every row `ids` names with `now`, then updates
// ChurchSettings' matching last-sent cursor -- shared by all three tier
// blocks in checkAndMaybeFlushEmailDispatch below since they're
// otherwise identical aside from which gate/column/cursor they use.
async function runEmailDispatchTier(tier, column, cursorField, settings, now) {
  const { consideredIds } = await sendDigestTier(tier, settings);
  if (consideredIds.length > 0) {
    await prisma.dispatchRecord.updateMany({
      where: { id: { in: consideredIds } },
      data: { [column]: now },
    });
  }
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: { [cursorField]: now } });
}

async function checkAndMaybeFlushEmailDispatch() {
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const now = new Date();

    if (shouldFlushBiweeklyEmailDispatch(settings, now)) {
      await runEmailDispatchTier(
        "biweekly",
        "biweeklyEmailDispatchSentAt",
        "lastBiweeklyEmailDispatchSentAt",
        settings,
        now
      );
    }
    if (shouldFlushMonthlyEmailDispatch(settings, now)) {
      await runEmailDispatchTier(
        "monthly",
        "monthlyEmailDispatchSentAt",
        "lastMonthlyEmailDispatchSentAt",
        settings,
        now
      );
    }
    if (shouldFlushQuarterlyEmailDispatch(settings, now)) {
      await runEmailDispatchTier(
        "quarterly",
        "quarterlyEmailDispatchSentAt",
        "lastQuarterlyEmailDispatchSentAt",
        settings,
        now
      );
    }

    await clearDispatchRecords();
  } catch (err) {
    // A failed check must never crash the scheduler itself -- it just
    // tries again next minute.
    console.error("Email dispatch schedule check failed:", err);
  }
}

// The shared chat tick: GroupMe and WhatsApp run off the same daily hour
// (ChurchSettings.chatDispatchHour), each with its own cursor and stamps.
// Each pass has its own try/catch so one channel failing -- WhatsApp
// disconnected, GroupMe's token revoked -- never skips the other or the
// clearing step. (Kept under its original name: it was GroupMe's tick
// first, and renaming exports would break anything importing it.)
async function checkAndMaybeFlushGroupMe() {
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const now = new Date();

    try {
      // Keeps the WhatsApp socket in step with the settings (opens it
      // when the feature is on and a number is paired, closes it when the
      // feature is turned off) -- a no-op for a church not using WhatsApp.
      await withTimeout(
        whatsappClient.syncWithSettings(settings, isFeatureEnabled(settings?.enabledFeatures, "whatsapp")),
        WHATSAPP_SYNC_TIMEOUT_MS,
        "WhatsApp connection sync"
      );
    } catch (err) {
      console.error("WhatsApp connection sync failed:", err);
    }

    try {
      await runGroupMePass(settings, now);
    } catch (err) {
      console.error("GroupMe pass failed:", err);
    }
    try {
      await runWhatsAppPass(settings, now);
    } catch (err) {
      console.error("WhatsApp pass failed:", err);
    }

    await clearDispatchRecords();
  } catch (err) {
    console.error("Chat schedule check failed:", err);
  }
}

// Called once from server.js at startup. Always registered regardless
// of whether a schedule is configured yet (both checks no-op
// immediately if not) -- so a schedule an admin sets or changes later
// takes effect on its very next matching minute, not just at the next
// server restart. noOverlap: true skips a tick if the previous one is
// still running, rather than stacking concurrent flushes.
function startEmailDispatchScheduler() {
  cron.schedule("* * * * *", checkAndMaybeFlushEmailDispatch, { name: "email-dispatch", noOverlap: true });
}

function startGroupMeScheduler() {
  cron.schedule("* * * * *", checkAndMaybeFlushGroupMe, { name: "chat-dispatch", noOverlap: true });
}

module.exports = {
  startEmailDispatchScheduler,
  startGroupMeScheduler,
  checkAndMaybeFlushEmailDispatch,
  checkAndMaybeFlushGroupMe,
  shouldFlushBiweeklyEmailDispatch,
  shouldFlushMonthlyEmailDispatch,
  shouldFlushQuarterlyEmailDispatch,
};
