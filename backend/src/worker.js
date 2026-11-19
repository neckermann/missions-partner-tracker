require("dotenv").config({ quiet: true });
// Same safety gate server.js boots under -- DATABASE_URL/SESSION_SECRET must
// still be real values here too, even though this process never signs a
// session itself. Refusing to boot on a bad config is cheap insurance; this
// process shares the exact same .env as the web service in every real
// deployment (see render.yaml), so there's no reason to carry a second,
// narrower validator just to skip the one check (SESSION_SECRET) it doesn't
// personally use.
require("./config/env").assertValidEnv();

// The background-job half of what server.js used to start inline (#271
// Phase B): the email/GroupMe/trip-reminder schedulers and the persistent
// WhatsApp connection, as their own process instead of sharing one with the
// HTTP server. No Express app, no app.listen, no port -- Render's
// Background Worker service type expects exactly that (no HTTP health
// check exists for this service type, unlike a web service).
//
// Why split at all: these four things used to run inside the same process
// that also answers every web request. A crash in the WhatsApp socket
// handling could take the whole site down with it, and -- the sharper
// problem -- this app can only ever safely run exactly one copy of these
// schedulers at a time. Scaling the web service to more than one instance
// used to mean every instance also ran its own copy of each scheduler,
// firing digests/reminders/GroupMe-WhatsApp posts multiple times over. One
// dedicated worker process removes both problems: the web tier can scale
// (or crash and restart) freely, and there is exactly one place these jobs
// ever run.
const { startEmailDispatchScheduler, startGroupMeScheduler } = require("./utils/emailDispatchScheduler");
const { startTripReminderScheduler } = require("./utils/tripReminderScheduler");
const whatsappClient = require("./utils/whatsappClient");
const { isFeatureEnabled } = require("./utils/features");
const prisma = require("./prismaClient");

// Guarded the same way server.js is -- lets this file be require()'d (by a
// future test, or anything else) without its cron timers/WhatsApp socket
// immediately starting and keeping that process alive.
if (require.main === module) {
  (async () => {
    // ChurchSettings.timezone must be applied to process.env.TZ once, here,
    // before any scheduler starts -- every Hour-based schedule check
    // (digest/chat-dispatch/trip-reminder) compares against
    // now.getHours(), and changing process.env.TZ after a Date-using
    // module has already run is documented as unreliable. This duplicates
    // server.js's own startup block deliberately: the two are separate
    // processes with separate env, so there is no way to share this read
    // once and have both pick it up -- each process needs its own copy.
    // Falls back to UTC on a fresh deploy (no ChurchSettings row yet) or a
    // transient DB hiccup, matching server.js's own fallback and this
    // field's own schema default.
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
    console.log("Missionary Tracker worker is running.");

    // Open the WhatsApp session now (if the feature is on and a number is
    // paired) rather than waiting up to a minute for the first scheduler
    // tick -- same reasoning server.js used to apply. A no-op for a church
    // that doesn't use WhatsApp.
    prisma.churchSettings
      .findUnique({ where: { id: "singleton" } })
      .then((settings) =>
        whatsappClient.syncWithSettings(settings, isFeatureEnabled(settings?.enabledFeatures, "whatsapp"))
      )
      .catch((err) => console.error("Couldn't start the WhatsApp connection at startup:", err));

    // Render runs the old and new instance side by side during a deploy,
    // and only one may hold the WhatsApp session -- same reasoning and the
    // same shutdown sequence server.js used to run. No HTTP server to
    // close here, just the socket and its advisory lock.
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
