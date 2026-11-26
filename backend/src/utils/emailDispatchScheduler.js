// In-process scheduler for both triggers: the email dispatch's three cadence
// tiers and GroupMe/WhatsApp's daily-hour chat schedule. Runs in the web process
// (no cron service); the database lock in backgroundJobs.js keeps it to one running instance.
//
// The two registrations tick every minute but check different schedule fields,
// so they stay independent. Both call clearDispatchRecords() at the end of their
// own run, since either can make a row clearable. Neither calls the other and
// dispatchOrchestrator.js calls neither; this file composes "run a pass, then clear".
//
// Hour/day checks use plain Date getters, so process.env.TZ must match the
// church's local time (see server.js's startup read of ChurchSettings.timezone).
const cron = require("node-cron");
const prisma = require("../prismaClient");
const { sendDigestTier } = require("./emailDispatchDelivery");
const { runGroupMePass } = require("./groupmeChannel");
const { runWhatsAppPass } = require("./whatsappChannel");
const whatsappClient = require("./whatsappClient");
const { isFeatureEnabled } = require("./features");
const { clearDispatchRecords } = require("./dispatchOrchestrator");

// Bounds how long one tick waits on whatsappClient.syncWithSettings, which can
// block on the advisory lock or the Baileys handshake. The cron job uses
// noOverlap: true, so an unbounded hang would skip every future tick (GroupMe
// sends, clearing) for every church on the instance. The timeout doesn't cancel
// connect(); it keeps running and updates whatsappClient's state, it just stops this tick waiting.
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

// Biweekly shares emailDispatchDayOfWeek; only the minimum gap below tells its
// two-week cycle apart from a mis-timed extra tick. Monthly and quarterly share
// emailDispatchDayOfMonth the same way. Day counts are approximate; hours don't matter here.
const MIN_GAP_MS = {
  biweekly: 13 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000,
  quarterly: 85 * 24 * 60 * 60 * 1000,
};

// Pure (no I/O, no Date.now()) so it's testable with a fixed `now`, independent
// of host timezone (test/emailDispatchScheduler.test.js).
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

// Stamps `column` on every row in `ids`, then the matching ChurchSettings
// last-sent cursor; shared by the three tier blocks.
async function runEmailDispatchTier(tier, column, cursorField, settings, now) {
  const { consideredIds } = await sendDigestTier(tier, settings);
  if (consideredIds.length > 0) {
    await prisma.dispatchRecord.updateMany({
      where: { id: { in: consideredIds } },
      data: { [column]: now, emailError: null },
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
    // A failed check must never crash the scheduler; it retries next minute.
    console.error("Email dispatch schedule check failed:", err);
  }
}

// The shared chat tick: GroupMe and WhatsApp share the daily hour
// (ChurchSettings.chatDispatchHour) with their own cursors and stamps. Each pass
// has its own try/catch so one channel failing never skips the other or the
// clearing step. (The name is historical; renaming would break importers.)
async function checkAndMaybeFlushGroupMe() {
  try {
    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    const now = new Date();

    try {
      // Keeps the WhatsApp socket in step with settings; a no-op without WhatsApp.
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

// Called once at startup. Always registered, even before a schedule is configured
// (the checks no-op), so a schedule set later takes effect on its next matching
// minute. noOverlap: true skips a tick while the previous one still runs.
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
