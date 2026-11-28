// Two instances of the app overlap during a deploy; only one may run the scheduled jobs. This takes the real
// Postgres advisory lock the app uses (utils/backgroundJobs.js) from two connections, as two instances would.
const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { acquireJobsLock } = require("../../src/utils/backgroundJobs");

const held = [];
after(async () => {
  for (const client of held) {
    try {
      await client.end();
    } catch (err) {
      // One the test already ended on purpose ("once the first exits") may be asked to end again; nothing else is fine.
      if (!/already|closed|ended/i.test(String(err?.message))) throw err;
    }
  }
});

describe("the background jobs lock", () => {
  test("a second instance cannot take it while the first holds it, and can once the first exits", async () => {
    const first = await acquireJobsLock();
    assert.ok(first, "the first instance gets it");
    held.push(first);

    assert.equal(await acquireJobsLock(), null, "the second instance is refused while the first runs");

    await first.end(); // the old instance exits (a deploy replaces it): its connection closes
    const second = await acquireJobsLock();
    assert.ok(second, "the second instance gets it once the first is gone");
    held.push(second);
  });
});
