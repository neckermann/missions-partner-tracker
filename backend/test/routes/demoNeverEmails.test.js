// A public demo never sends its SCHEDULED email: its accounts are fake, so mail would only bounce and
// spend the email plan. An email a person adds or clicks to send still goes. The marker lives in the
// database (ChurchSettings.demoMode, written by the demo reset) because the worker that runs the
// schedules does not get the web service's DEMO_RESET_TOKEN. With the flag set and no variable, the
// schedules skip and a hand-made send is still attempted.
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

describe("a demo skips its scheduled emails, not the ones a person sends", () => {
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

  test("a send a person makes is not blocked on a demo", async () => {
    // With no Postmark account set up here the provider is never reached, so a real attempt fails; the
    // point is that it is attempted (a skipped demo send would resolve with `demo: true` instead).
    const attempt = await sendEmail({ to: "a@example.test", subject: "s", text: "t" }).then(
      (r) => r,
      (err) => ({ failed: err.message })
    );
    assert.notEqual(attempt?.demo, true, "a demo does not swallow a hand-made send");
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
