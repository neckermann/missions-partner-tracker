// The scheduled jobs (email digests, GroupMe and WhatsApp posts, trip and key-date reminders, care chat posts,
// scheduled reports, the audit clean-up) and the WhatsApp connection. They run inside the web process; there is
// no separate worker service (it cost extra, needed its own copies of the secrets, and nothing told you when it
// was not running).
//
// They must run in exactly one place at a time, or every digest, reminder and post would fire twice. Render
// starts a new instance while the old one is still running during a deploy, so the process takes a Postgres
// advisory lock on its own connection before it starts anything, and keeps it for as long as it lives: a
// second instance waits (retrying) until the first one exits and releases it. The same pattern whatsappClient.js
// uses to keep one WhatsApp session. Closing the connection, which happens when the process ends, releases it.
const { Client } = require("pg");
const { parseDatabaseUrl } = require("./databaseUrl");

// Fixed: every instance must use the same number to contend for the same lock. (whatsappClient.js has its own.)
const JOBS_LOCK_KEY = "7204117103";
const RETRY_MS = 15 * 1000;
const LOCK_CONNECT_TIMEOUT_MS = 10 * 1000;

// "on" or "off" forces it; otherwise only a production deployment runs them, so `npm run dev` on a laptop that
// points at a database with real email settings never sends anything by itself.
function backgroundJobsEnabled(env = process.env) {
  if (env.BACKGROUND_JOBS === "on") return true;
  if (env.BACKGROUND_JOBS === "off") return false;
  return env.NODE_ENV === "production";
}

// Takes the lock on a dedicated connection, or returns null if another instance holds it.
async function acquireJobsLock() {
  const client = new Client({
    ...parseDatabaseUrl(process.env.DATABASE_URL),
    connectionTimeoutMillis: LOCK_CONNECT_TIMEOUT_MS,
  });
  // An unhandled 'error' on a pg client crashes the process.
  client.on("error", (err) => console.error("Background jobs lock connection error:", err.message));
  await client.connect();
  const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [JOBS_LOCK_KEY]);
  if (!rows[0].locked) {
    await client.end().catch(() => {});
    return null;
  }
  return client;
}

function startAllSchedulers() {
  const { startEmailDispatchScheduler, startGroupMeScheduler } = require("./emailDispatchScheduler");
  const { startTripReminderScheduler } = require("./tripReminderScheduler");
  const { startKeyDateReminderScheduler } = require("./keyDateReminderScheduler");
  const { startCareChatDispatchScheduler } = require("./careChatDispatch");
  const { startReportScheduler } = require("./reportScheduler");
  const { startAuditPruneScheduler } = require("./auditPruneScheduler");
  startEmailDispatchScheduler();
  startGroupMeScheduler();
  startTripReminderScheduler();
  startKeyDateReminderScheduler();
  startCareChatDispatchScheduler();
  startReportScheduler();
  startAuditPruneScheduler();
}

// Opens the WhatsApp session now rather than waiting up to a minute for the first tick; a no-op without
// WhatsApp.
async function openWhatsApp() {
  const prisma = require("../prismaClient");
  const whatsappClient = require("./whatsappClient");
  const { isFeatureEnabled } = require("./features");
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  await whatsappClient.syncWithSettings(settings, isFeatureEnabled(settings?.enabledFeatures, "whatsapp"));
}

const defaultDeps = {
  acquire: acquireJobsLock,
  startSchedulers: startAllSchedulers,
  openWhatsApp,
  retryMs: RETRY_MS,
};

const state = { lockClient: null, retryTimer: null, started: false, stopped: false };

// Starts the jobs once this process holds the lock; until then retries every `retryMs`. Resolves after the first
// attempt (it does not wait for a lock held elsewhere). `deps` is for tests.
async function startBackgroundJobs(deps = defaultDeps) {
  const { acquire, startSchedulers, openWhatsApp: open, retryMs } = { ...defaultDeps, ...deps };
  state.stopped = false;

  async function attempt() {
    if (state.stopped || state.started) return;
    let client = null;
    try {
      client = await acquire();
    } catch (err) {
      console.error("Background jobs: couldn't take the jobs lock, will retry:", err.message);
    }
    if (state.stopped) {
      await client?.end?.().catch(() => {});
      return;
    }
    if (!client) {
      state.retryTimer = setTimeout(attempt, retryMs);
      state.retryTimer.unref?.();
      return;
    }
    state.lockClient = client;
    state.started = true;
    console.log("Background jobs starting (schedulers + WhatsApp connection)...");
    startSchedulers();
    Promise.resolve(open()).catch((err) =>
      console.error("Couldn't start the WhatsApp connection at startup:", err)
    );
  }

  await attempt();
}

// On shutdown: stop retrying, close the WhatsApp socket, release the lock so the next instance can take over.
async function stopBackgroundJobs() {
  state.stopped = true;
  clearTimeout(state.retryTimer);
  state.retryTimer = null;
  if (state.started) {
    const whatsappClient = require("./whatsappClient");
    await whatsappClient.shutdown().catch(() => {});
  }
  const client = state.lockClient;
  state.lockClient = null;
  state.started = false;
  if (client) await client.end().catch(() => {});
}

module.exports = {
  JOBS_LOCK_KEY,
  backgroundJobsEnabled,
  acquireJobsLock,
  startBackgroundJobs,
  stopBackgroundJobs,
};
