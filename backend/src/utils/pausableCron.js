// node-cron's schedule(), except a tick that lands while an in-app restore is running is skipped. A scheduled job
// writing halfway through a restore could collide with the rows being put back (or be wiped by the replace), so
// the schedulers wait: each is a "check what is due" pass, so the next tick picks up whatever was skipped.
const cron = require("node-cron");
const { isRestoreRunning } = require("./restoreLock");

function schedule(expression, task, options) {
  return cron.schedule(
    expression,
    (...args) => {
      if (isRestoreRunning()) return undefined;
      return task(...args);
    },
    options
  );
}

module.exports = { schedule };
