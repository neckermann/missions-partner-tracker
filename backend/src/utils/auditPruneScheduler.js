// Daily prune of the activity trail (#341) -- its own cron registration in the
// worker, same shape as keyDateReminderScheduler.js. 03:30 church-local (the
// worker applies ChurchSettings.timezone to TZ), a quiet hour. Idempotent:
// running it twice deletes nothing the second time.
const cron = require("node-cron");
const { pruneAuditLog } = require("./auditLog");

function startAuditPruneScheduler() {
  cron.schedule("30 3 * * *", async () => {
    try {
      const { deleted, days } = await pruneAuditLog();
      if (deleted > 0) console.log(`Pruned ${deleted} activity log entries older than ${days} days.`);
    } catch (err) {
      console.error("Activity log prune failed:", err);
    }
  });
}

module.exports = { startAuditPruneScheduler };
