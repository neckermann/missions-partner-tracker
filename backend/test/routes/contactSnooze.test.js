// "Not this season" and the quiet clock's start (C8). A partner nobody has contacted yet counts quiet from the
// day they joined someone's care list, not from the first minute, so a new install is not instantly all
// overdue; and a snooze date keeps a partner out of "quiet" until that day. A follow-up date someone set on
// purpose still counts while a partner is snoozed. The snooze is staff-facing: the public site never carries it.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { loadAssignedPartners } = require("../../src/utils/contactLogQueries");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

const DAY = 86400000;
const utcDay = (offsetDays = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays));
};
const ymd = (d) => d.toISOString().slice(0, 10);

let admin;
let editor;
let viewer;
let anon;
let user;
let originalSettings;

async function partnerOnList({ joinedDaysAgo = 0, tag }) {
  const partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} snooze ${tag}`, isPublic: true },
  });
  await prisma.careTeamMember.create({
    data: { partnerId: partner.id, userId: user.id, createdAt: new Date(Date.now() - joinedDaysAgo * DAY) },
  });
  return partner;
}

async function rowFor(partnerId) {
  const rows = await loadAssignedPartners(user.id, new Date());
  return rows.find((r) => r.partnerId === partnerId);
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  anon = await client(null);
  await removeFixturePartners();
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { contactStaleDays: true, enabledFeatures: true },
  });
  // A fresh install has care teams and the public directory off, so switch on what this file needs.
  const enabledFeatures = {
    ...(originalSettings?.enabledFeatures || {}),
    careTeam: true,
    contactLog: true,
    publicDirectory: true,
  };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { contactStaleDays: 90, enabledFeatures },
    create: { id: "singleton", contactStaleDays: 90, enabledFeatures },
  });
  const email = "route-test-snooze-user@example.test";
  user = await prisma.user.upsert({
    where: { email },
    update: { active: true, role: "editor" },
    create: {
      email,
      passwordHash: await bcrypt.hash("RouteTestSnooze123!", 4),
      role: "editor",
      authProvider: "local",
      active: true,
    },
  });
});

after(async () => {
  await removeFixturePartners();
  if (user) await prisma.user.deleteMany({ where: { id: user.id } });
  await removeTestUsers();
  if (originalSettings) {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: {
        contactStaleDays: originalSettings.contactStaleDays ?? 90,
        enabledFeatures: originalSettings.enabledFeatures ?? {},
      },
    });
  }
  await stopServer();
});

describe("the quiet clock starts when a partner joins the list", () => {
  test("a partner nobody has contacted, just added to a list, is not quiet", async () => {
    const p = await partnerOnList({ tag: "new" });
    const row = await rowFor(p.id);
    assert.equal(row.quiet, false);
    assert.equal(row.daysSinceContact, null);
    assert.equal(row.daysOnList, 0);
    assert.equal(row.overdueSince, null);
  });

  test("the same partner turns quiet once they have been on the list for the quiet threshold", async () => {
    const early = await partnerOnList({ joinedDaysAgo: 89, tag: "day89" });
    const due = await partnerOnList({ joinedDaysAgo: 91, tag: "day91" });
    assert.equal((await rowFor(early.id)).quiet, false);
    const row = await rowFor(due.id);
    assert.equal(row.quiet, true);
    assert.ok(row.overdueSince, "and they are overdue from the day the clock ran out");
  });

  test("a partner contacted long ago is quiet even if they only just joined the list", async () => {
    const p = await partnerOnList({ tag: "oldcontact" });
    await prisma.contactLog.create({
      data: {
        partnerId: p.id,
        contactType: "call",
        direction: "outbound",
        topics: [],
        contactDate: utcDay(-120),
        createdById: user.id,
      },
    });
    const row = await rowFor(p.id);
    assert.equal(row.quiet, true);
    assert.equal(row.daysSinceContact, 120);
  });

  test("the list ranks a never-contacted partner by how long they have been on it, not above everyone", async () => {
    const contacted = await partnerOnList({ tag: "rank-contacted" });
    await prisma.contactLog.create({
      data: {
        partnerId: contacted.id,
        contactType: "call",
        direction: "outbound",
        topics: [],
        contactDate: utcDay(-200),
        createdById: user.id,
      },
    });
    const fresh = await partnerOnList({ tag: "rank-fresh" });
    const rows = await loadAssignedPartners(user.id, new Date());
    const order = rows.map((r) => r.partnerId);
    assert.ok(
      order.indexOf(contacted.id) < order.indexOf(fresh.id),
      "200 days quiet outranks a partner added today"
    );
  });
});

describe("not this season", () => {
  test("a snoozed partner is not quiet until that day, and says so", async () => {
    const p = await partnerOnList({ joinedDaysAgo: 200, tag: "snoozed" });
    assert.equal((await rowFor(p.id)).quiet, true, "quiet before the snooze");
    await prisma.partner.update({ where: { id: p.id }, data: { contactSnoozedUntil: utcDay(30) } });
    const row = await rowFor(p.id);
    assert.equal(row.quiet, false);
    assert.equal(row.snoozedUntil, ymd(utcDay(30)));
    assert.equal(row.overdueSince, null, "nothing is overdue while it is snoozed");
  });

  test("the snooze ends on its own: the day it runs out the partner is quiet again", async () => {
    const p = await partnerOnList({ joinedDaysAgo: 200, tag: "expired" });
    await prisma.partner.update({ where: { id: p.id }, data: { contactSnoozedUntil: utcDay(-1) } });
    const row = await rowFor(p.id);
    assert.equal(row.quiet, true);
    assert.equal(row.snoozedUntil, null);
    // Until today is still snoozed; the day itself is not.
    await prisma.partner.update({ where: { id: p.id }, data: { contactSnoozedUntil: utcDay(0) } });
    assert.equal((await rowFor(p.id)).quiet, true, "the snooze date itself is the first day back");
  });

  test("a follow-up date someone set on purpose still counts while snoozed", async () => {
    const p = await partnerOnList({ joinedDaysAgo: 200, tag: "followup" });
    await prisma.contactLog.create({
      data: {
        partnerId: p.id,
        contactType: "call",
        direction: "outbound",
        topics: [],
        contactDate: utcDay(-10),
        followUpDate: utcDay(-1),
        createdById: user.id,
      },
    });
    await prisma.partner.update({ where: { id: p.id }, data: { contactSnoozedUntil: utcDay(60) } });
    const row = await rowFor(p.id);
    assert.equal(row.quiet, false);
    assert.equal(row.followUpDue, true);
    assert.ok(row.overdueSince, "the follow-up is still due");
  });
});

describe("setting the snooze", () => {
  test("staff set it, change it and clear it with a blank", async () => {
    const p = await partnerOnList({ tag: "api" });
    const set = await editor(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { contactSnoozedUntil: "2031-03-01" },
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(ymd(new Date(set.body.contactSnoozedUntil)), "2031-03-01");
    const cleared = await editor(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { contactSnoozedUntil: "" },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.contactSnoozedUntil, null);
    const row = await prisma.partner.findUnique({
      where: { id: p.id },
      select: { contactSnoozedUntil: true },
    });
    assert.equal(row.contactSnoozedUntil, null);
  });

  test("a bad date is refused and a viewer cannot set it", async () => {
    const p = await partnerOnList({ tag: "api2" });
    assert.equal(
      (await admin(`/api/partners/${p.id}`, { method: "PUT", body: { contactSnoozedUntil: "next spring" } }))
        .status,
      400
    );
    assert.equal(
      (await viewer(`/api/partners/${p.id}`, { method: "PUT", body: { contactSnoozedUntil: "2031-03-01" } }))
        .status,
      403
    );
  });

  test("the public site never carries it", async () => {
    const p = await partnerOnList({ tag: "public" });
    await prisma.partner.update({ where: { id: p.id }, data: { contactSnoozedUntil: utcDay(30) } });
    const list = await anon("/api/public/partners");
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.body).includes("contactSnoozedUntil"));
    const one = await anon(`/api/public/partners/${p.id}`);
    assert.ok([200, 404].includes(one.status));
    assert.ok(!JSON.stringify(one.body).includes("contactSnoozedUntil"));
  });
});

describe("any sign of life resets the quiet clock, not only a logged contact", () => {
  // Joined the list long ago and nothing logged: quiet. Then each of these arrives.
  const oldDate = utcDay(-200);
  const cases = [
    [
      "a newsletter filed",
      (id, when) =>
        prisma.partnerFile.create({
          data: {
            partnerId: id,
            kind: "newsletter",
            receivedDate: when,
            fileName: "n.pdf",
            contentType: "application/pdf",
            bytesRow: { create: { bytes: Buffer.from("%PDF-fixture") } },
          },
        }),
    ],
    [
      "a prayer request received",
      (id, when) =>
        prisma.prayerRequest.create({
          data: { partnerId: id, category: "strategic", requestText: "x", dateReceived: when },
        }),
    ],
    [
      "a visit to our church",
      (id, when) => prisma.churchVisit.create({ data: { partnerId: id, visitDate: when } }),
    ],
    [
      "a logged contact",
      (id, when) =>
        prisma.contactLog.create({
          data: { partnerId: id, contactDate: when, contactType: "email", direction: "outbound" },
        }),
    ],
  ];

  for (const [label, make] of cases) {
    test(`${label} 10 days ago clears "quiet"; the same dated 200 days ago does not`, async () => {
      const p = await partnerOnList({ joinedDaysAgo: 200, tag: label });
      assert.equal((await rowFor(p.id)).quiet, true, "quiet before anything arrives");
      await make(p.id, oldDate);
      assert.equal((await rowFor(p.id)).quiet, true, "an old one does not help");
      await make(p.id, utcDay(-10));
      const row = await rowFor(p.id);
      assert.equal(row.quiet, false);
      assert.equal(row.daysSinceContact, 10);
      assert.equal(row.lastContact, ymd(utcDay(-10)));
    });
  }

  test("something dated in the future does not count, and a photo does not either", async () => {
    const p = await partnerOnList({ joinedDaysAgo: 200, tag: "future" });
    await prisma.prayerRequest.create({
      data: { partnerId: p.id, category: "strategic", requestText: "x", dateReceived: utcDay(5) },
    });
    await prisma.churchVisit.create({ data: { partnerId: p.id, visitDate: utcDay(30) } });
    assert.equal((await rowFor(p.id)).quiet, true);
  });
});
