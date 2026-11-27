// The partner contact log. Covers the feature gate (404 off, data kept), who may log / fix /
// delete (anyone who can see the partner logs; a guest only through a care team seat, never
// through a trip grant alone; admin/editor fix and delete), validation, the references an
// entry may point at, the My partners read model, the prayer-request auto-log, and the single
// primary contact per partner.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

let admin;
let editor;
let viewer;
let originalEnabledFeatures;
let partnerA;
let partnerB;
let member; // guest on partnerA's care team
let tripLeader; // guest with only a trip grant on partnerA
const extraUsers = [];

async function setFeatures(patch) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabledFeatures = { ...(current?.enabledFeatures || {}), ...patch };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
}

async function makeGuest(tag) {
  const email = `route-test-contact-${tag}@example.test`;
  const password = "RouteTestContact123!";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 4), role: "guest", active: true },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash(password, 4),
      role: "guest",
      authProvider: "local",
      active: true,
    },
  });
  extraUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

const log = (who, body) => who("/api/contact-log", { method: "POST", body });
const entry = (partnerId, extra = {}) => ({
  partnerId,
  contactType: "call",
  direction: "outbound",
  contactDate: "2026-01-05",
  ...extra,
});

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  // trips: the trip-leader fixture below needs a real trip, and a fresh database has the feature off
  await setFeatures({
    contactLog: true,
    careTeam: true,
    prayerRequests: true,
    oneTimeNeeds: true,
    trips: true,
  });
  partnerA = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} logA` },
    })
  ).body;
  partnerB = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} logB` },
    })
  ).body;

  const m = await makeGuest("member");
  await prisma.careTeamMember.create({ data: { partnerId: partnerA.id, userId: m.user.id } });
  member = m;

  const t = await makeGuest("tripleader");
  const trip = await admin("/api/trips", {
    method: "POST",
    body: { partnerId: partnerA.id, status: "planning" },
  });
  await prisma.tripAccess.create({ data: { userId: t.user.id, tripId: trip.body.id } });
  tripLeader = t;
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners(); // cascades logs, trips, adults
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("contact log: the feature gate", () => {
  test("404s every route while off, and keeps the data", async () => {
    const made = await log(admin, entry(partnerA.id, { notes: "kept while off" }));
    assert.equal(made.status, 201);
    await setFeatures({ contactLog: false });
    try {
      assert.equal((await admin(`/api/contact-log?partnerId=${partnerA.id}`)).status, 404);
      assert.equal((await admin("/api/contact-log/options")).status, 404);
      assert.equal((await log(admin, entry(partnerA.id))).status, 404);
    } finally {
      await setFeatures({ contactLog: true });
    }
    const list = await admin(`/api/contact-log?partnerId=${partnerA.id}`);
    assert.ok(
      list.body.some((e) => e.id === made.body.id),
      "the entry survived the flag going off"
    );
  });

  test("serves the fixed lists", async () => {
    const res = await viewer("/api/contact-log/options");
    assert.equal(res.status, 200);
    assert.ok(res.body.types.some((t) => t.value === "call"));
    assert.ok(res.body.directions.some((d) => d.value === "inbound"));
    assert.ok(res.body.topics.some((t) => t.value === "prayer"));
    assert.equal(typeof res.body.staleDays, "number");
  });
});

describe("contact log: logging and reading", () => {
  test("anyone who can see the partner can log, defaulting who to themselves and the date to today", async () => {
    for (const who of [admin, editor, viewer]) {
      const res = await log(who, {
        partnerId: partnerA.id,
        contactType: "text",
        direction: "inbound",
        topics: ["prayer", "prayer"],
      });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body.topics, ["prayer"], "duplicate topics collapse");
      assert.ok(res.body.contactedBy?.id, "who defaults to the logger");
      assert.equal(res.body.contactedBy.id, res.body.createdBy.id);
      assert.equal(res.body.contactDate.slice(0, 10), new Date().toISOString().slice(0, 10));
    }
  });

  test("lists newest first and needs a partner", async () => {
    await log(admin, entry(partnerB.id, { contactDate: "2026-01-01", notes: "older" }));
    await log(admin, entry(partnerB.id, { contactDate: "2026-03-01", notes: "newer" }));
    const list = await viewer(`/api/contact-log?partnerId=${partnerB.id}`);
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.map((e) => e.notes),
      ["newer", "older"]
    );
    assert.equal((await viewer("/api/contact-log")).status, 400);
  });

  test("rejects values outside the fixed lists", async () => {
    assert.equal((await log(admin, entry(partnerA.id, { contactType: "carrier-pigeon" }))).status, 400);
    assert.equal((await log(admin, entry(partnerA.id, { direction: "sideways" }))).status, 400);
    assert.equal((await log(admin, entry(partnerA.id, { topics: ["gossip"] }))).status, 400);
    assert.equal((await log(admin, entry("no-such-partner"))).status, 404);
  });

  test("an entry can only point at a need or prayer request of its own partner, and an active login", async () => {
    const need = await admin("/api/support-needs", {
      method: "POST",
      body: {
        partnerId: partnerB.id,
        description: "b's need",
        requestedAmount: 100,
        requestDate: "2026-01-01",
      },
    });
    assert.equal(need.status, 201);
    const wrong = await log(admin, entry(partnerA.id, { supportNeedId: need.body.id }));
    assert.equal(wrong.status, 400);
    const right = await log(admin, entry(partnerB.id, { supportNeedId: need.body.id, topics: ["need"] }));
    assert.equal(right.status, 201);
    assert.equal(right.body.supportNeedId, need.body.id);

    const gone = await makeGuest("inactive-who");
    await prisma.user.update({ where: { id: gone.user.id }, data: { active: false } });
    assert.equal((await log(admin, entry(partnerA.id, { contactedById: gone.user.id }))).status, 400);
  });

  test("an entry can name the support option it was about, kept as a label even if the option is later deleted", async () => {
    const option = await prisma.supportOption.create({
      data: { group: `${FIXTURE_TAG} tag`, label: "Airport pick-up", kind: "offer" },
    });
    const secret = await prisma.supportOption.create({
      data: { group: `${FIXTURE_TAG} tag`, label: "Staff only", kind: "offer", staffOnly: true },
    });
    try {
      const made = await log(admin, entry(partnerA.id, { supportOptionId: option.id }));
      assert.equal(made.status, 201);
      assert.equal(made.body.supportOptionId, option.id);
      assert.equal(made.body.supportOptionLabel, "Airport pick-up");
      assert.equal((await log(admin, entry(partnerA.id, { supportOptionId: "nope" }))).status, 400);

      const guest = await member.login();
      assert.equal((await log(guest, entry(partnerA.id, { supportOptionId: secret.id }))).status, 400);
      assert.equal((await log(guest, entry(partnerA.id, { supportOptionId: option.id }))).status, 201);

      await prisma.supportOption.delete({ where: { id: option.id } });
      const row = await prisma.contactLog.findUnique({ where: { id: made.body.id } });
      assert.equal(row.supportOptionLabel, "Airport pick-up", "history survives the option");
    } finally {
      await prisma.supportOption.deleteMany({ where: { group: `${FIXTURE_TAG} tag` } });
    }
  });
});

describe("contact log: the all-entries listing", () => {
  test("pages newest first, filters, and a guest only sees their own partners", async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(
        (
          await log(
            admin,
            entry(partnerA.id, { contactType: i === 0 ? "visit" : "call", contactDate: `2026-03-0${i + 1}` })
          )
        ).status,
        201
      );
    }
    await log(admin, entry(partnerB.id, { contactType: "card", contactDate: "2026-03-10" }));

    const mine = await admin(`/api/contact-log/all?partnerId=${partnerA.id}&limit=2`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.rows.length, 2);
    assert.ok(mine.body.total >= 3 && mine.body.hasMore);
    assert.equal(mine.body.rows[0].partner.id, partnerA.id);
    const page2 = await admin(`/api/contact-log/all?partnerId=${partnerA.id}&limit=2&offset=2`);
    assert.ok(page2.body.rows.length >= 1);
    assert.ok(mine.body.rows[0].contactDate >= mine.body.rows[1].contactDate, "newest first");

    const visits = await admin(`/api/contact-log/all?partnerId=${partnerA.id}&contactType=visit`);
    assert.ok(visits.body.rows.length >= 1 && visits.body.rows.every((r) => r.contactType === "visit"));
    assert.equal((await admin("/api/contact-log/all?limit=999")).status, 400);

    const guest = await member.login();
    const asGuest = await guest("/api/contact-log/all");
    assert.equal(asGuest.status, 200);
    assert.ok(asGuest.body.rows.length > 0 && asGuest.body.rows.every((r) => r.partner.id === partnerA.id));
    assert.equal((await guest(`/api/contact-log/all?partnerId=${partnerB.id}`)).status, 403);
    assert.equal((await viewer("/api/contact-log/all")).status, 200);
  });
});

describe("contact log: fixing and deleting", () => {
  test("admin and editor can fix and delete; a viewer can only add", async () => {
    const made = (await log(viewer, entry(partnerA.id, { notes: "typo" }))).body;
    assert.equal(
      (await viewer(`/api/contact-log/${made.id}`, { method: "PUT", body: { notes: "fixed" } })).status,
      403
    );
    assert.equal((await viewer(`/api/contact-log/${made.id}`, { method: "DELETE" })).status, 403);

    const fixed = await editor(`/api/contact-log/${made.id}`, {
      method: "PUT",
      body: { notes: "fixed", contactType: "video", partnerId: partnerB.id },
    });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.notes, "fixed");
    assert.equal(fixed.body.contactType, "video");
    assert.equal(fixed.body.partnerId, partnerA.id, "an entry can't be moved to another partner");

    assert.equal((await editor(`/api/contact-log/${made.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await admin(`/api/contact-log/${made.id}`, { method: "DELETE" })).status, 404);
  });
});

describe("contact log: guests", () => {
  test("a care team member logs and reads their own partner, and only theirs", async () => {
    const m = await member.login();
    const res = await log(m, entry(partnerA.id, { notes: "from the member" }));
    assert.equal(res.status, 201);
    const list = await m(`/api/contact-log?partnerId=${partnerA.id}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.some((e) => e.id === res.body.id));
    assert.equal((await m(`/api/contact-log?partnerId=${partnerB.id}`)).status, 403);
    assert.equal((await log(m, entry(partnerB.id))).status, 403);
    // ...but can't fix or delete, even their own entry
    assert.equal((await m(`/api/contact-log/${res.body.id}`, { method: "DELETE" })).status, 403);
  });

  test("a trip leader (a trip grant alone) has no access, same line as one-time needs", async () => {
    const t = await tripLeader.login();
    assert.equal((await t(`/api/contact-log?partnerId=${partnerA.id}`)).status, 403);
    assert.equal((await log(t, entry(partnerA.id))).status, 403);
  });
});

describe("contact log: My partners", () => {
  test("lists the seats a login holds, with the care columns", async () => {
    const m = await member.login();
    const fresh = await makeGuest("assigned");
    await prisma.careTeamMember.create({
      data: { partnerId: partnerB.id, userId: fresh.user.id, isLead: true },
    });
    await admin("/api/prayer-requests", {
      method: "POST",
      body: {
        partnerId: partnerB.id,
        category: "situational",
        requestText: "open prayer",
        dateReceived: "2026-01-01",
      },
    });
    const a = await fresh.login();
    const res = await a("/api/contact-log/assigned");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    const row = res.body[0];
    assert.equal(row.partnerId, partnerB.id);
    assert.equal(row.isLead, true);
    assert.equal(row.openPrayers, 1);
    assert.equal(row.openNeeds, 1, "partnerB has the pending need logged above");
    // partnerB has logged contacts from earlier tests (2026), so it's long quiet
    assert.equal(row.quiet, true);
    assert.ok(row.daysSinceContact > 0);

    // a login with no seats gets an empty list, and the care team flag gates it
    const other = await m("/api/contact-log/assigned");
    assert.deepEqual(
      other.body.map((r) => r.partnerId),
      [partnerA.id]
    );
    await setFeatures({ careTeam: false });
    try {
      // Care teams off is not an error: seats are ignored, so someone on no missions team looks after nothing.
      // (a seat-only guest has no way in at all while care teams are off, so ask as staff)
      const none = await admin("/api/contact-log/assigned");
      assert.equal(none.status, 200);
      assert.deepEqual(none.body, []);
    } finally {
      await setFeatures({ careTeam: true });
    }
  });

  test("a partner with a recent contact is not quiet, and a due follow-up is flagged", async () => {
    const solo = await makeGuest("recent");
    const partner = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} logRecent` },
      })
    ).body;
    await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: solo.user.id } });
    const s = await solo.login();

    let row = (await s("/api/contact-log/assigned")).body[0];
    assert.equal(row.daysSinceContact, null, "never contacted");
    assert.equal(row.quiet, false, "just added to the list: the quiet clock has not run yet");
    // Once they have been on the list longer than the quiet threshold, never contacted means quiet.
    await prisma.careTeamMember.updateMany({
      where: { partnerId: partner.id },
      data: { createdAt: new Date(Date.now() - 100 * 86400000) },
    });
    row = (await s("/api/contact-log/assigned")).body[0];
    assert.equal(row.quiet, true);

    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await log(admin, entry(partner.id, { contactDate: todayStr, followUpDate: yesterday }));
    row = (await s("/api/contact-log/assigned")).body[0];
    assert.equal(row.daysSinceContact, 0);
    assert.equal(row.quiet, false);
    assert.equal(row.followUpDue, true, "a follow-up date in the past is due");

    // a later contact answers the follow-up
    await log(admin, entry(partner.id, { contactDate: todayStr }));
    row = (await s("/api/contact-log/assigned")).body[0];
    assert.equal(row.followUpDue, false);
    assert.equal(row.followUpDate, null);
  });
});

describe("contact log: prayer requests", () => {
  const prayer = (extra = {}) => ({
    partnerId: partnerA.id,
    category: "situational",
    requestText: "auto-log prayer",
    dateReceived: "2026-02-02",
    ...extra,
  });

  test("a care team member's new request also logs the contact; staff's does not", async () => {
    const m = await member.login();
    const res = await m("/api/prayer-requests", { method: "POST", body: prayer() });
    assert.equal(res.status, 201);
    const auto = await prisma.contactLog.findFirst({ where: { prayerRequestId: res.body.id } });
    assert.ok(auto, "the contact was logged");
    assert.equal(auto.direction, "inbound");
    assert.deepEqual(auto.topics, ["prayer"]);
    assert.equal(auto.partnerId, partnerA.id);

    const staff = await admin("/api/prayer-requests", {
      method: "POST",
      body: prayer({ requestText: "staff entered" }),
    });
    assert.equal(staff.status, 201);
    assert.equal(await prisma.contactLog.count({ where: { prayerRequestId: staff.body.id } }), 0);
  });

  test("deleting the request keeps the history", async () => {
    const m = await member.login();
    const res = await m("/api/prayer-requests", {
      method: "POST",
      body: prayer({ requestText: "to be deleted" }),
    });
    await admin(`/api/prayer-requests/${res.body.id}`, { method: "DELETE" });
    assert.ok(await prisma.contactLog.findFirst({ where: { prayerRequestId: res.body.id } }));
  });

  test("nothing is logged while the contact log is off", async () => {
    await setFeatures({ contactLog: false });
    try {
      const m = await member.login();
      const res = await m("/api/prayer-requests", {
        method: "POST",
        body: prayer({ requestText: "while off" }),
      });
      assert.equal(res.status, 201);
      assert.equal(await prisma.contactLog.count({ where: { prayerRequestId: res.body.id } }), 0);
    } finally {
      await setFeatures({ contactLog: true });
    }
  });
});

describe("contact card: primary contact and instructions", () => {
  const adult = (extra = {}) => ({ partnerId: partnerA.id, firstName: "Sam", ...extra });

  test("at most one adult per partner is the primary contact", async () => {
    const one = await editor("/api/adults", {
      method: "POST",
      body: adult({ firstName: "One", isPrimaryContact: true }),
    });
    const two = await editor("/api/adults", {
      method: "POST",
      body: adult({ firstName: "Two", isPrimaryContact: true }),
    });
    assert.equal(one.status, 201);
    assert.equal(two.status, 201);
    let rows = await prisma.adult.findMany({ where: { partnerId: partnerA.id, isPrimaryContact: true } });
    assert.deepEqual(
      rows.map((r) => r.firstName),
      ["Two"],
      "creating a new primary clears the old one"
    );

    const moved = await editor(`/api/adults/${one.body.id}`, {
      method: "PUT",
      body: { isPrimaryContact: true },
    });
    assert.equal(moved.status, 200);
    rows = await prisma.adult.findMany({ where: { partnerId: partnerA.id, isPrimaryContact: true } });
    assert.deepEqual(
      rows.map((r) => r.firstName),
      ["One"]
    );

    // the database refuses two even if a writer bypasses the route
    await assert.rejects(
      prisma.adult.update({ where: { id: two.body.id }, data: { isPrimaryContact: true } }),
      /Unique constraint|duplicate key/i
    );
  });

  test("a care team member can set the primary contact on their partner, not on another", async () => {
    const m = await member.login();
    const a = await m("/api/adults", {
      method: "POST",
      body: adult({ firstName: "FromMember", isPrimaryContact: true }),
    });
    assert.equal(a.status, 201);
    const other = await m("/api/adults", {
      method: "POST",
      body: { partnerId: partnerB.id, firstName: "Nope" },
    });
    assert.equal(other.status, 403);
  });

  test("special communication instructions save with the partner", async () => {
    const res = await editor(`/api/partners/${partnerA.id}`, {
      method: "PUT",
      body: { contactLevel: "no_direct", contactInstructions: "  Email only; never call after 8pm.  " },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.contactLevel, "no_direct");
    assert.equal(res.body.contactInstructions, "Email only; never call after 8pm.");
    const read = await viewer(`/api/partners/${partnerA.id}`);
    assert.equal(read.body.contactInstructions, "Email only; never call after 8pm.");
  });
});

describe("the contact card: how to reach a partner", () => {
  const adult = (extra = {}) => ({ partnerId: partnerA.id, firstName: "Sam", ...extra });

  test("an adult carries the way they like to be reached, and only a known way is accepted", async () => {
    const made = await editor("/api/adults", {
      method: "POST",
      body: adult({ firstName: "Methodical", contactMethod: "signal" }),
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.contactMethod, "signal");
    const other = await editor(`/api/adults/${made.body.id}`, {
      method: "PUT",
      body: adult({ firstName: "Methodical", contactMethod: "other", contactMethodNote: "  Telegram  " }),
    });
    assert.equal(other.status, 200, JSON.stringify(other.body));
    assert.equal(other.body.contactMethod, "other");
    assert.equal(other.body.contactMethodNote, "Telegram");
    const bad = await editor(`/api/adults/${made.body.id}`, {
      method: "PUT",
      body: adult({ firstName: "Methodical", contactMethod: "carrier-pigeon" }),
    });
    assert.equal(bad.status, 400);
  });

  test("caution keeps the partner reachable but limits the ways, no_direct names who to go through", async () => {
    const caution = await editor(`/api/partners/${partnerA.id}`, {
      method: "PUT",
      body: {
        contactLevel: "caution",
        contactChannels: ["email", "whatsapp"],
        contactInstructions: "Please don't say 'mission' in the subject.",
      },
    });
    assert.equal(caution.status, 200, JSON.stringify(caution.body));
    assert.equal(caution.body.contactLevel, "caution");
    assert.deepEqual(caution.body.contactChannels, ["email", "whatsapp"]);

    const via = await editor(`/api/partners/${partnerA.id}`, {
      method: "PUT",
      body: {
        contactLevel: "no_direct",
        contactChannels: [],
        contactViaName: "Mission office",
        contactViaRole: "Sending organization",
        contactViaPhone: "(555) 555-0100",
        contactViaEmail: "office@example.org",
      },
    });
    assert.equal(via.status, 200, JSON.stringify(via.body));
    const read = await viewer(`/api/partners/${partnerA.id}`);
    assert.equal(read.body.contactLevel, "no_direct");
    assert.equal(read.body.contactViaName, "Mission office");
    assert.equal(read.body.contactViaEmail, "office@example.org");

    for (const body of [{ contactLevel: "kinda" }, { contactChannels: ["pigeon"] }]) {
      const res = await editor(`/api/partners/${partnerA.id}`, { method: "PUT", body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    await editor(`/api/partners/${partnerA.id}`, {
      method: "PUT",
      body: { contactLevel: "normal", contactChannels: [], contactViaName: null, contactInstructions: null },
    });
  });

  test("an organization's named contact carries its own way to be reached", async () => {
    const org = await admin("/api/partners", {
      method: "POST",
      body: {
        kind: "organization",
        displayName: `${FIXTURE_TAG} Org ${Date.now()}`,
        contactFirstName: "Olive",
        contactEmail: "olive@example.org",
        contactMethod: "email",
        contactMethodNote: "mornings",
      },
    });
    assert.equal(org.status, 201, JSON.stringify(org.body));
    assert.equal(org.body.contactMethod, "email");
    assert.equal(org.body.contactMethodNote, "mornings");
  });
});

describe("contact log: needs-attention notification and the Last heard from report", () => {
  const find = (res) => res.body.categories.find((c) => c.key === "partnersNeedingContact");

  test("counts a care team member's overdue partners, clears on contact, and is off with the feature", async () => {
    const who = await makeGuest("notify");
    const partner = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} logNotify` },
      })
    ).body;
    // On the list for longer than the quiet threshold (a partner just added is not quiet yet).
    await prisma.careTeamMember.create({
      data: { partnerId: partner.id, userId: who.user.id, createdAt: new Date(Date.now() - 100 * 86400000) },
    });
    const g = await who.login();

    // never contacted, and on the list for 100 days: quiet; a guest sees this category
    let cat = find(await g("/api/notifications/summary"));
    assert.ok(cat, "a care team guest sees the category");
    assert.equal(cat.count, 1);
    assert.equal(cat.linkTo, "/admin/partners?assigned=1");

    await log(admin, entry(partner.id, { contactDate: new Date().toISOString().slice(0, 10) }));
    cat = find(await g("/api/notifications/summary"));
    assert.equal(cat.count, 0, "a recent contact clears it");

    // a due follow-up brings it back
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await log(admin, entry(partner.id, { contactDate: "2026-01-01", followUpDate: yesterday }));
    // (the later, earlier-dated entry doesn't answer it: today's contact is already logged, but
    // this entry's follow-up is newer than any contact dated on/after it that was entered later)
    cat = find(await g("/api/notifications/summary"));
    assert.equal(cat.count, 1);

    await setFeatures({ contactLog: false });
    try {
      assert.equal(find(await admin("/api/notifications/summary")).count, 0);
    } finally {
      await setFeatures({ contactLog: true });
    }
  });

  test("a trip leader sees a zero count, and staff with no seats see zero", async () => {
    const t = await tripLeader.login();
    const c = find(await t("/api/notifications/summary"));
    assert.equal(c?.count ?? 0, 0);
    assert.equal(find(await viewer("/api/notifications/summary")).count, 0);
  });

  test("Last heard from counts a logged contact while the log is on, and shows the column", async () => {
    const partner = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} logReport` },
      })
    ).body;
    const today = new Date().toISOString().slice(0, 10);
    await log(admin, entry(partner.id, { contactDate: today }));
    await setFeatures({ reports: true });
    const res = await admin("/api/reports/last-heard-from?onlyStale=false");
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.partnerName === `${FIXTURE_TAG} logReport`);
    assert.equal(row.contact, today);
    // (the report's "today" is local, the test's date is UTC: they can differ by a day)
    assert.ok([0, -1].includes(row.contactDays));
    const quiet = await admin("/api/reports/last-heard-from");
    assert.ok(
      !quiet.body.rows.some((r) => r.partnerName === `${FIXTURE_TAG} logReport`),
      "recently contacted is not quiet"
    );
  });
});
