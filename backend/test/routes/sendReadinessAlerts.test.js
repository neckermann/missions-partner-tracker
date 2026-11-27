// A channel that is switched on but cannot send gets its own admin alert (bell and Home), each linking to the
// page that fixes it. Nothing here connects a real channel: the states are written straight to ChurchSettings.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

const FIELDS = {
  enabledFeatures: true,
  postmarkServerToken: true,
  emailFromAddress: true,
  emailDispatchDayOfWeek: true,
  emailDispatchDayOfMonth: true,
  emailDispatchHour: true,
  cadenceBiweeklyEnabled: true,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
  chatDispatchHour: true,
  groupmeAccessToken: true,
  groupmeGroupId: true,
  whatsappPairedAt: true,
  whatsappAnnouncementGroupId: true,
};

// Everything off and empty; each test switches on only what it is about.
const BLANK = {
  enabledFeatures: { outboundEmail: false, groupme: false, whatsapp: false },
  postmarkServerToken: null,
  emailFromAddress: null,
  emailDispatchDayOfWeek: null,
  emailDispatchDayOfMonth: null,
  emailDispatchHour: null,
  cadenceBiweeklyEnabled: false,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
  chatDispatchHour: null,
  groupmeAccessToken: null,
  groupmeGroupId: null,
  whatsappPairedAt: null,
  whatsappAnnouncementGroupId: null,
};

const NEW_KEYS = ["emailScheduleNotSet", "groupmeNotFinished", "whatsappNotFinished", "chatTimeNotSet"];

let admin;
let editor;
let original;

async function setSettings(data) {
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { ...BLANK, ...data },
    create: { id: "singleton", ...BLANK, ...data },
  });
}

// { key: category } for the alerts that are showing (count above zero).
async function alerts(as = admin) {
  const res = await as("/api/notifications/summary");
  assert.equal(res.status, 200);
  return Object.fromEntries(res.body.categories.filter((c) => c.count > 0).map((c) => [c.key, c]));
}

before(async () => {
  await ensureTestUsers();
  [admin, editor] = await Promise.all([client("admin"), client("editor")]);
  original = await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: FIELDS });
});

after(async () => {
  if (original) await prisma.churchSettings.update({ where: { id: "singleton" }, data: original });
  await removeTestUsers();
  await stopServer();
});

const emailSetUp = {
  enabledFeatures: { outboundEmail: true, groupme: false, whatsapp: false },
  postmarkServerToken: encryptField("pm-test-token"),
  emailFromAddress: "updates@example.test",
};

describe("alerts for a channel that is on but cannot send", () => {
  test("nothing is shown while every channel is off", async () => {
    await setSettings({});
    const showing = await alerts();
    for (const key of NEW_KEYS) assert.equal(showing[key], undefined, key);
  });

  test("email set up with no schedule", async () => {
    await setSettings(emailSetUp);
    const item = (await alerts()).emailScheduleNotSet;
    assert.ok(item, "the alert is showing");
    assert.equal(item.linkTo, "/admin/settings/dispatches");
    assert.match(item.label, /no schedule/);
    assert.ok(item.isNew);
  });

  test("a rhythm ticked with no day, and a day with no time, are 'half set'", async () => {
    await setSettings({ ...emailSetUp, emailDispatchHour: 9 });
    assert.match((await alerts()).emailScheduleNotSet.label, /half set/);
    await setSettings({ ...emailSetUp, emailDispatchDayOfMonth: 5 });
    assert.match((await alerts()).emailScheduleNotSet.label, /half set/);
  });

  test("a complete email schedule clears it", async () => {
    await setSettings({ ...emailSetUp, emailDispatchDayOfMonth: 5, emailDispatchHour: 9 });
    assert.equal((await alerts()).emailScheduleNotSet, undefined);
  });

  test("email on but not set up shows the existing notice only, not a second one about the schedule", async () => {
    await setSettings({ enabledFeatures: { outboundEmail: true, groupme: false, whatsapp: false } });
    const showing = await alerts();
    assert.ok(showing.emailNotFinished);
    assert.equal(showing.emailScheduleNotSet, undefined);
  });

  test("GroupMe on with no token or no group, and no chat time", async () => {
    await setSettings({ enabledFeatures: { outboundEmail: false, groupme: true, whatsapp: false } });
    let showing = await alerts();
    assert.equal(showing.groupmeNotFinished.linkTo, "/admin/settings/groupme");
    assert.equal(showing.chatTimeNotSet.linkTo, "/admin/settings/dispatches");
    assert.equal(showing.whatsappNotFinished, undefined);

    await setSettings({
      enabledFeatures: { outboundEmail: false, groupme: true, whatsapp: false },
      groupmeAccessToken: encryptField("gm-test-token"),
    });
    assert.ok((await alerts()).groupmeNotFinished, "a token with no group still cannot post");

    await setSettings({
      enabledFeatures: { outboundEmail: false, groupme: true, whatsapp: false },
      groupmeAccessToken: encryptField("gm-test-token"),
      groupmeGroupId: "12345",
      chatDispatchHour: 9,
    });
    showing = await alerts();
    assert.equal(showing.groupmeNotFinished, undefined);
    assert.equal(showing.chatTimeNotSet, undefined);
  });

  test("WhatsApp on and not linked", async () => {
    await setSettings({
      enabledFeatures: { outboundEmail: false, groupme: false, whatsapp: true },
      chatDispatchHour: 9,
    });
    let showing = await alerts();
    assert.equal(showing.whatsappNotFinished.linkTo, "/admin/settings/whatsapp");
    assert.equal(showing.chatTimeNotSet, undefined);
    assert.equal(showing.groupmeNotFinished, undefined);

    await setSettings({
      enabledFeatures: { outboundEmail: false, groupme: false, whatsapp: true },
      chatDispatchHour: 9,
      whatsappPairedAt: new Date(),
      whatsappAnnouncementGroupId: "120363000000000000@g.us",
    });
    showing = await alerts();
    assert.equal(showing.whatsappNotFinished, undefined);
  });

  test("only admins are told", async () => {
    await setSettings({
      ...emailSetUp,
      enabledFeatures: { outboundEmail: true, groupme: true, whatsapp: true },
    });
    const forAdmin = await alerts();
    for (const key of NEW_KEYS) assert.ok(forAdmin[key], `${key} shows for an admin`);
    const res = await editor("/api/notifications/summary");
    for (const key of NEW_KEYS) {
      assert.ok(!res.body.categories.some((c) => c.key === key), `${key} is not listed for an editor`);
    }
  });

  test("once seen it stops being new, and stays listed until fixed", async () => {
    await setSettings(emailSetUp);
    await admin("/api/notifications/seen", { method: "POST", body: { category: "emailScheduleNotSet" } });
    const item = (await alerts()).emailScheduleNotSet;
    assert.ok(item, "still listed: nothing was fixed");
    assert.equal(item.isNew, false);
  });
});
