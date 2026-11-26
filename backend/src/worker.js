require("dotenv").config({ quiet: true });
// Same safety gate as server.js: DATABASE_URL/SESSION_SECRET must be real values
// here too, since this process shares the web service's .env (see render.yaml).
require("./config/env").assertValidEnv();

// The background-job process: the email/GroupMe/trip-reminder schedulers and the
// persistent WhatsApp connection. No Express app or port (a Render Background
// Worker has no HTTP health check).
//
// Split from the web process so a WhatsApp crash can't take down the site and
// the web tier can scale freely: these jobs must run in exactly one place, or
// every instance would fire digests/reminders/posts multiple times.
const { startEmailDispatchScheduler, startGroupMeScheduler } = require("./utils/emailDispatchScheduler");
const { startTripReminderScheduler } = require("./utils/tripReminderScheduler");
const { startKeyDateReminderScheduler } = require("./utils/keyDateReminderScheduler");
const { startCareChatDispatchScheduler } = require("./utils/careChatDispatch");
const { startReportScheduler } = require("./utils/reportScheduler");
const { startAuditPruneScheduler } = require("./utils/auditPruneScheduler");
const whatsappClient = require("./utils/whatsappClient");
const { isFeatureEnabled } = require("./utils/features");
const prisma = require("./prismaClient");

// Guarded like server.js so this file can be require()'d without starting cron timers or the WhatsApp socket.
if (require.main === module) {
  (async () => {
    // Apply ChurchSettings.timezone to process.env.TZ once before any scheduler
    // starts: Hour-based checks compare against now.getHours(), and changing TZ
    // later is unreliable. Duplicates server.js's block deliberately (separate
    // processes). Falls back to UTC on a fresh deploy or transient DB error.
    try {
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { timezone: true },
      });
      process.env.TZ = settings?.timezone || "UTC";
    } catch (err) {
      console.error("Couldn't read ChurchSettings.timezone at startup, defaulting to UTC:", err);
      process.env.TZ = process.env.TZ || "UTC";
    }

    console.log("Missionary Tracker worker starting (schedulers + WhatsApp connection)...");
    startEmailDispatchScheduler();
    startGroupMeScheduler();
    startTripReminderScheduler();
    startKeyDateReminderScheduler();
    startCareChatDispatchScheduler();
    startReportScheduler();
    startAuditPruneScheduler();
    console.log("Missionary Tracker worker is running.");

    // Open the WhatsApp session now rather than waiting up to a minute for the first tick; no-op without WhatsApp.
    prisma.churchSettings
      .findUnique({ where: { id: "singleton" } })
      .then((settings) =>
        whatsappClient.syncWithSettings(settings, isFeatureEnabled(settings?.enabledFeatures, "whatsapp"))
      )
      .catch((err) => console.error("Couldn't start the WhatsApp connection at startup:", err));

    // Old and new instances overlap during a deploy and only one may hold the
    // WhatsApp session; just close the socket and release its advisory lock.
    const shutdown = async () => {
      console.log("Missionary Tracker worker shutting down...");
      await whatsappClient.shutdown().catch(() => {});
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  })();
}

module.exports = {};
