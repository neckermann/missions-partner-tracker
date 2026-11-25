// Daily audit-trail prune: its own worker cron, like keyDateReminderScheduler.js.
// 03:30 church-local. Idempotent.
const cron = require("node-cron");
const { pruneAuditLog } = require("./auditLog");

function startAuditPruneScheduler() {
  cron.schedule("30 3 * * *", async () => {
    try {
      const { deleted, days } = await pruneAuditLog();
      if (deleted > 0) console.log(`Pruned ${deleted} audit log entries older than ${days} days.`);
    } catch (err) {
      console.error("Audit log prune failed:", err);
    }
  });
}

module.exports = { startAuditPruneScheduler };
