// Two emails that only exist while Email (Sending) is on: a new trip application goes to the trip's team, and
// admins get a monthly backup reminder. With email off, nothing is sent and the bell and pages still show them.
// `send` is injected, so nothing reaches Postmark.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { notifyTripTeamOfApplication } = require("../../src/utils/tripApplicationNotice");
const { sendBackupReminderEmails, EMAIL_CATEGORY } = require("../../src/utils/backupReminderEmail");

const TAG = "ZZTEST-tripBackupEmail";
const MAIL = "trip-backup-email-test";
let original;

async function patch(data) {
  return prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });
}
const emailOn = (on = true) => patch({ enabledFeatures: { trips: true, outboundEmail: on } });

const collector = () => {
  const sent = [];
  return { sent, send: async (m) => sent.push(m), mine: () => sent.filter((m) => m.to.includes(MAIL)) };
};

async function person(tag, role, extra = {}) {
  return prisma.user.create({
    data: {
      email: `${MAIL}-${tag}@example.test`,
      firstName: tag,
      passwordHash: "x",
      role,
      authProvider: "local",
      active: true,
      ...extra,
    },
  });
}

async function cleanup() {
  await prisma.trip.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.user.deleteMany({ where: { email: { contains: MAIL } } });
}

before(async () => {
  original = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  await cleanup();
});
beforeEach(async () => {
  await cleanup();
  await patch({ backupReminderDisabled: false });
  await emailOn();
});
after(async () => {
  await cleanup();
  await patch({
    enabledFeatures: original?.enabledFeatures ?? {},
    backupReminderDisabled: original?.backupReminderDisabled ?? false,
  });
});

describe("trip application email", () => {
  async function trip() {
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${TAG} partner` },
    });
    return prisma.trip.create({
      data: {
        name: `${TAG} trip`,
        partnerId: partner.id,
        startDate: new Date("2027-06-01"),
        endDate: new Date("2027-06-10"),
      },
    });
  }
  const application = { firstName: "Dana", lastName: "Reed", email: "dana@example.test", phone: "555" };

  test("goes to admins only, not editors, viewers or the trip's own leaders", async () => {
    const t = await trip();
    const admin = await person("admin", "admin");
    const editor = await person("editor", "editor");
    const viewer = await person("viewer", "viewer");
    const leader = await person("leader", "guest");
    await prisma.tripAccess.create({ data: { userId: leader.id, tripId: t.id } });
    const c = collector();
    await notifyTripTeamOfApplication(t.id, application, { send: c.send });
    assert.deepEqual(
      c.mine().map((m) => m.to),
      [admin.email]
    );
    assert.ok(![editor.email, viewer.email, leader.email].some((e) => c.mine().some((m) => m.to === e)));
    const mail = c.mine()[0];
    assert.match(mail.subject, new RegExp(`New application for ${TAG} trip`));
    assert.ok(mail.text.includes("Dana Reed"));
    assert.ok(
      !mail.text.includes("dana@example.test") && !mail.text.includes("555"),
      "no contact details leave the app"
    );
    assert.ok(mail.text.includes(`/admin/trips/${t.id}/team`));
  });

  test("an inactive admin is not emailed", async () => {
    const t = await trip();
    const gone = await person("gone", "admin", { active: false });
    const c = collector();
    await notifyTripTeamOfApplication(t.id, application, { send: c.send });
    assert.ok(!c.mine().some((m) => m.to === gone.email));
  });

  test("sends nothing with email off, so the bell and Team page are the only notice", async () => {
    const t = await trip();
    await person("admin2", "admin");
    await emailOn(false);
    const c = collector();
    assert.equal(await notifyTripTeamOfApplication(t.id, application, { send: c.send }), 0);
    assert.equal(c.sent.length, 0);
  });

  test("one failed address does not stop the rest", async () => {
    const t = await trip();
    const bad = await person("bad", "admin");
    const good = await person("good", "admin");
    const sent = [];
    const send = async (m) => {
      if (m.to === bad.email) throw new Error("postmark blip");
      sent.push(m.to);
    };
    await notifyTripTeamOfApplication(t.id, application, { send });
    assert.ok(sent.includes(good.email));
  });
});

describe("backup reminder email", () => {
  test("goes to each admin once a month, not to other roles", async () => {
    const admin = await person("b-admin", "admin");
    const editor = await person("b-editor", "editor");
    const c1 = collector();
    await sendBackupReminderEmails({ send: c1.send });
    assert.deepEqual(
      c1.mine().map((m) => m.to),
      [admin.email]
    );
    assert.ok(!c1.mine().some((m) => m.to === editor.email));
    assert.match(c1.mine()[0].subject, /backups/i);

    const c2 = collector();
    await sendBackupReminderEmails({ send: c2.send });
    assert.equal(c2.mine().length, 0, "not again within 30 days");

    const c3 = collector();
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await sendBackupReminderEmails({ send: c3.send, now: later });
    assert.equal(c3.mine().length, 1, "and again after 30 days");
  });

  test("an admin who just dismissed the in-app reminder is left alone", async () => {
    const admin = await person("b-dismissed", "admin");
    await prisma.notificationSeen.create({ data: { userId: admin.id, category: "timeToCheckBackups" } });
    const c = collector();
    await sendBackupReminderEmails({ send: c.send });
    assert.equal(c.mine().length, 0);
  });

  test("sends nothing with email off or once the reminder is turned off for good", async () => {
    await person("b-off", "admin");
    await emailOn(false);
    const c1 = collector();
    await sendBackupReminderEmails({ send: c1.send });
    assert.equal(c1.mine().length, 0);
    await emailOn(true);
    await patch({ backupReminderDisabled: true });
    const c2 = collector();
    await sendBackupReminderEmails({ send: c2.send });
    assert.equal(c2.mine().length, 0);
  });

  test("a failed send leaves no marker, so it retries", async () => {
    const admin = await person("b-retry", "admin");
    await sendBackupReminderEmails({
      send: async () => {
        throw new Error("postmark blip");
      },
    });
    const marker = await prisma.notificationSeen.findUnique({
      where: { userId_category: { userId: admin.id, category: EMAIL_CATEGORY } },
    });
    assert.equal(marker, null);
    const c = collector();
    await sendBackupReminderEmails({ send: c.send });
    assert.equal(c.mine().length, 1);
  });
});
