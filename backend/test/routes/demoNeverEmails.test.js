// A public demo never sends email: its accounts are fake, so mail would only bounce and spend the
// email plan. The marker lives in the database (ChurchSettings.demoMode, written by the demo reset)
// because the worker that runs the schedules does not get the web service's DEMO_RESET_TOKEN. With
// the flag set and no variable, every send is skipped without calling the provider.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { sendEmail, sendEmailBatch } = require("../../src/utils/email");
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

describe("a demo never emails", () => {
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

  test("a send and a batch are skipped, not delivered", async () => {
    const one = await sendEmail({ to: "a@example.test", subject: "s", text: "t" });
    assert.equal(one.demo, true);
    assert.equal(one.ErrorCode, 0);
    const many = await sendEmailBatch([{ To: "a@example.test" }, { To: "b@example.test" }]);
    assert.equal(many.length, 2);
    assert.ok(many.every((r) => r.demo === true));
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
