// The scheduled jobs run inside the web process, behind a database lock so two overlapping instances
// (Render runs the old and the new one together during a deploy) never both run them. These use stand-ins
// for the lock and the schedulers; the real lock against Postgres is in test/routes/backgroundJobsLock.test.js.
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  backgroundJobsEnabled,
  startBackgroundJobs,
  stopBackgroundJobs,
} = require("../src/utils/backgroundJobs");

describe("backgroundJobsEnabled", () => {
  test("on in production, off elsewhere, unless forced either way", () => {
    assert.equal(backgroundJobsEnabled({ NODE_ENV: "production" }), true);
    assert.equal(backgroundJobsEnabled({ NODE_ENV: "development" }), false);
    assert.equal(backgroundJobsEnabled({}), false);
    assert.equal(backgroundJobsEnabled({ NODE_ENV: "development", BACKGROUND_JOBS: "on" }), true);
    assert.equal(backgroundJobsEnabled({ NODE_ENV: "production", BACKGROUND_JOBS: "off" }), false);
  });
});

describe("startBackgroundJobs", () => {
  let started;
  let opened;
  beforeEach(async () => {
    await stopBackgroundJobs();
    started = 0;
    opened = 0;
  });
  const deps = (acquire, retryMs = 5) => ({
    acquire,
    startSchedulers: () => (started += 1),
    openWhatsApp: async () => (opened += 1),
    retryMs,
  });
  const lock = () => ({ end: async () => {} });

  test("starts the schedulers and the WhatsApp connection once it holds the lock", async () => {
    await startBackgroundJobs(deps(async () => lock()));
    assert.equal(started, 1);
    assert.equal(opened, 1);
  });

  test("starts nothing while another instance holds the lock, then starts when it is released", async () => {
    let held = true;
    await startBackgroundJobs(deps(async () => (held ? null : lock())));
    assert.equal(started, 0, "the old instance still has the lock");
    held = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(started, 1);
  });

  test("a failed attempt to reach the database is retried, not fatal", async () => {
    let calls = 0;
    await startBackgroundJobs(
      deps(async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection refused");
        return lock();
      })
    );
    assert.equal(started, 0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(started, 1);
  });

  test("never starts twice", async () => {
    await startBackgroundJobs(deps(async () => lock()));
    await startBackgroundJobs(deps(async () => lock()));
    assert.equal(started, 1);
  });

  test("stopping releases the lock and stops retrying", async () => {
    let ended = 0;
    await startBackgroundJobs(deps(async () => ({ end: async () => (ended += 1) })));
    await stopBackgroundJobs();
    assert.equal(ended, 1);

    let held = true;
    await startBackgroundJobs(deps(async () => (held ? null : lock())));
    await stopBackgroundJobs();
    held = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(started, 1, "only the first start; the stopped retry never fires");
  });
});
