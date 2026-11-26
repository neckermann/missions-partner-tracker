// A public demo sends no email: its accounts are fake, so scheduled mail would only bounce and spend the
// email plan, and a hand-made send would go out from the real sender at a stranger's request. The marker
// lives in the database (ChurchSettings.demoMode, written by the demo reset) because the worker that
// runs the schedules does not get the web service's DEMO_RESET_TOKEN. With the flag set and no variable,
// the schedules skip and so does every send. DEMO_TESTING_SITE (the owner's own test deployment) sends.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { sendEmail } = require("../../src/utils/email");
const { forgetDemoModeCache, isDemoInstance } = require("../../src/utils/demoMode");
const { checkAndSendKeyDateReminders } = require("../../src/utils/keyDateReminderScheduler");
const { stopServer } = require("./helpers");

let originalDemoMode;
let originalToken;

before(async () => {
  originalToken = process.env.DEMO_RESET_TOKEN;
  delete process.env.DEMO_RESET_TOKEN;
  const row = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  originalDemoMode = row?.demoMode ?? false;
});

after(async () => {
  if (originalToken !== undefined) process.env.DEMO_RESET_TOKEN = originalToken;
  await prisma.churchSettings.updateMany({
    where: { id: "singleton" },
    data: { demoMode: originalDemoMode },
  });
  forgetDemoModeCache();
  await stopServer();
});

describe("a demo sends no email, scheduled or by hand", () => {
  test("the database flag marks a demo even where the variable is missing (the worker)", async () => {
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { demoMode: false },
      create: { id: "singleton", demoMode: false },
    });
    forgetDemoModeCache();
    assert.equal(await isDemoInstance(), false);
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { demoMode: true } });
    forgetDemoModeCache();
    assert.equal(await isDemoInstance(), true);
  });

  // Reversed deliberately (A1, November 2026 review): a demo's published logins are open to anyone, so a
  // hand-made send (a welcome email, a trip invite) would go out from the real sender at a stranger's
  // request. The database flag is enough to know it is a demo, so this holds in the worker too.
  test("a send a person makes is not sent on a demo either", async () => {
    const result = await sendEmail({ to: "a@example.test", subject: "s", text: "t" });
    assert.equal(result.MessageID, "demo-not-sent", "a demo sends nothing real");
  });

  test("the owner's own test deployment still sends", async () => {
    process.env.DEMO_TESTING_SITE = "true";
    try {
      // With no Postmark account set up here the provider is never reached, so a real attempt fails;
      // the point is that it is attempted rather than swallowed.
      const attempt = await sendEmail({ to: "a@example.test", subject: "s", text: "t" }).then(
        (r) => r,
        (err) => ({ failed: err.message })
      );
      assert.notEqual(attempt.MessageID, "demo-not-sent");
    } finally {
      delete process.env.DEMO_TESTING_SITE;
    }
  });

  test("the key-date schedule sends nothing", async () => {
    let calls = 0;
    const result = await checkAndSendKeyDateReminders({
      send: async () => {
        calls += 1;
      },
    });
    assert.deepEqual(result, { sent: 0, recipients: 0 });
    assert.equal(calls, 0);
  });
});
