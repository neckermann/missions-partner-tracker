const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodeCron = require("node-cron");
const { schedule } = require("../src/utils/pausableCron");
const { beginRestore, endRestore } = require("../src/utils/restoreLock");

// A scheduled job's tick that lands while an in-app restore is running is skipped (it would write halfway through
// the replace); every other tick runs as normal and gets the job's own arguments and result.
test("a tick is skipped while a restore runs, and runs again when it ends", async () => {
  const original = nodeCron.schedule;
  let tick;
  nodeCron.schedule = (_expression, fn) => {
    tick = fn;
  };
  try {
    let runs = 0;
    schedule("* * * * *", async (arg) => {
      runs += 1;
      return `ran ${arg}`;
    });
    assert.equal(await tick("a"), "ran a");
    assert.equal(runs, 1);

    assert.equal(beginRestore(), true);
    try {
      assert.equal(await tick("b"), undefined);
      assert.equal(runs, 1, "the job did not run during the restore");
    } finally {
      endRestore();
    }
    assert.equal(await tick("c"), "ran c");
    assert.equal(runs, 2);
  } finally {
    nodeCron.schedule = original;
  }
});
