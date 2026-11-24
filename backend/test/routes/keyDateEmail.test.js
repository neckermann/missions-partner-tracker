// #291: the daily key-date email run -- gated by the three features, one
// grouped message per person, never the same occurrence twice, a failed send
// retried, and a logged "key date" contact suppressing it. `send` is injected,
// so nothing reaches Postmark.
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
const { checkAndSendKeyDateReminders } = require("../../src/utils/keyDateReminderScheduler");

let admin;
let originalEnabledFeatures;
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

async function makeUser(tag) {
  const email = `route-test-kdmail-${tag}@example.test`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "guest", active: true },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash("x", 4),
      role: "guest",
      authProvider: "local",
      active: true,
    },
  });
  extraUsers.push(user.id);
  return user;
}

function dateIn(n, yearsAgo = 30) {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  return `${t.getUTCFullYear() - yearsAgo}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const newPartner = async (tag, extra = {}) =>
  (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} kdm ${tag}`, ...extra },
    })
  ).body;
const addAdult = (partnerId, birthday, firstName = "Dana") =>
  admin("/api/adults", { method: "POST", body: { partnerId, firstName, lastName: "Reed", birthday } });

// Only mail to the users this file created matters; seeded partners with
// random birthdays have no team, so they reach nobody.
function collector(failFor = []) {
  const sent = [];
  const send = async (m) => {
    if (failFor.includes(m.to)) throw new Error("postmark blip");
    sent.push(m);
  };
  return { sent, send, mine: () => sent.filter((m) => m.to.startsWith("route-test-kdmail-")) };
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ keyDates: true, careTeam: true, outboundEmail: true, contactLog: true });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("key-date email: the daily run", () => {
  test("sends ONE grouped email per person, to every team member, and never twice", async () => {
    const a = await newPartner("a");
    const b = await newPartner("b");
    await addAdult(a.id, dateIn(2));
    await addAdult(b.id, dateIn(5), "Sam");
    const lead = await makeUser("lead");
    const member = await makeUser("member");
    await prisma.careTeamMember.createMany({
      data: [
        { partnerId: a.id, userId: lead.id, isLead: true },
        { partnerId: b.id, userId: lead.id, isLead: true },
        { partnerId: a.id, userId: member.id },
      ],
    });

    const run1 = collector();
    await checkAndSendKeyDateReminders({ send: run1.send });
    const mine = run1.mine();
    assert.equal(mine.length, 2, "one email each for the lead and the member, not one per partner");
    const leadMail = mine.find((m) => m.to === lead.email);
    const memberMail = mine.find((m) => m.to === member.email);
    assert.match(leadMail.subject, /^2 key dates/);
    assert.ok(
      leadMail.text.includes(`${FIXTURE_TAG} kdm a`) && leadMail.text.includes(`${FIXTURE_TAG} kdm b`)
    );
    assert.match(memberMail.subject, /^1 key date /);
    assert.equal(await prisma.keyDateReminder.count({ where: { userId: lead.id } }), 2);

    const run2 = collector();
    await checkAndSendKeyDateReminders({ send: run2.send });
    assert.equal(run2.mine().length, 0, "the same occurrences are never mailed again");
  });

  test("sends nothing while any of the three features is off", async () => {
    const p = await newPartner("gates");
    await addAdult(p.id, dateIn(2));
    const u = await makeUser("gates");
    await prisma.careTeamMember.create({ data: { partnerId: p.id, userId: u.id } });
    for (const flag of ["keyDates", "careTeam", "outboundEmail"]) {
      await setFeatures({ [flag]: false });
      try {
        const c = collector();
        const result = await checkAndSendKeyDateReminders({ send: c.send });
        assert.equal(c.sent.length, 0, `${flag} off`);
        assert.equal(result.sent, 0);
      } finally {
        await setFeatures({ [flag]: true });
      }
    }
    const c = collector();
    await checkAndSendKeyDateReminders({ send: c.send });
    assert.equal(c.mine().length, 1, "and it goes out once they're back on");
  });

  test("sends nothing on a public demo, even with every feature on", async () => {
    const p = await newPartner("demo");
    await addAdult(p.id, dateIn(2));
    const u = await makeUser("demo");
    await prisma.careTeamMember.create({ data: { partnerId: p.id, userId: u.id } });
    const original = process.env.DEMO_RESET_TOKEN;
    process.env.DEMO_RESET_TOKEN = "test-demo-token";
    try {
      const c = collector();
      const result = await checkAndSendKeyDateReminders({ send: c.send });
      assert.equal(c.sent.length, 0, "a demo never emails its fake accounts");
      assert.deepEqual(result, { sent: 0, recipients: 0 });
    } finally {
      if (original === undefined) delete process.env.DEMO_RESET_TOKEN;
      else process.env.DEMO_RESET_TOKEN = original;
    }
    // ...and it goes out as normal once it is no longer a demo
    const c2 = collector();
    await checkAndSendKeyDateReminders({ send: c2.send });
    assert.equal(c2.mine().filter((m) => m.to === u.email).length, 1);
  });

  test("a failed send leaves no record and is retried; the others still get theirs", async () => {
    const p = await newPartner("retry");
    await addAdult(p.id, dateIn(3));
    const good = await makeUser("retry-good");
    const bad = await makeUser("retry-bad");
    await prisma.careTeamMember.createMany({
      data: [
        { partnerId: p.id, userId: good.id },
        { partnerId: p.id, userId: bad.id },
      ],
    });
    const first = collector([bad.email]);
    await checkAndSendKeyDateReminders({ send: first.send });
    assert.deepEqual(
      first.mine().map((m) => m.to),
      [good.email]
    );
    assert.equal(await prisma.keyDateReminder.count({ where: { userId: bad.id } }), 0);

    const second = collector();
    await checkAndSendKeyDateReminders({ send: second.send });
    assert.deepEqual(
      second.mine().map((m) => m.to),
      [bad.email],
      "tomorrow's tick retries only the one that failed"
    );
  });

  test("a logged 'key date' contact suppresses the email", async () => {
    const p = await newPartner("handled");
    await addAdult(p.id, dateIn(2));
    const u = await makeUser("handled");
    await prisma.careTeamMember.create({ data: { partnerId: p.id, userId: u.id } });
    await prisma.contactLog.create({
      data: {
        partnerId: p.id,
        contactType: "card",
        direction: "outbound",
        topics: ["keydate"],
        contactDate: new Date(),
      },
    });
    const c = collector();
    await checkAndSendKeyDateReminders({ send: c.send });
    assert.equal(c.mine().filter((m) => m.to === u.email).length, 0);
  });

  test("a restricted partner is masked and a not-safe-to-contact one gets the pointer, in the real email", async () => {
    const p = await newPartner("masked", {
      isRestricted: true,
      displayName: `${FIXTURE_TAG} Mary Lou Green`,
    });
    await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: { contactSafe: false, contactInstructions: "SECRET relay only" },
    });
    await addAdult(p.id, dateIn(2), "Maryann");
    const u = await makeUser("masked");
    await prisma.careTeamMember.create({ data: { partnerId: p.id, userId: u.id } });
    const c = collector();
    await checkAndSendKeyDateReminders({ send: c.send });
    const mail = c.mine().find((m) => m.to === u.email);
    assert.ok(mail, "the team still gets told");
    assert.ok(
      !mail.text.includes("Mary Lou Green") && !mail.text.includes("Maryann"),
      "no real names leave the app"
    );
    assert.ok(!mail.text.includes("SECRET"), "never the instructions themselves");
    assert.match(mail.text, /special communication instructions apply/);
  });

  test("an inactive login gets nothing", async () => {
    const p = await newPartner("inactive");
    await addAdult(p.id, dateIn(2));
    const u = await makeUser("inactive");
    await prisma.careTeamMember.create({ data: { partnerId: p.id, userId: u.id } });
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    const c = collector();
    await checkAndSendKeyDateReminders({ send: c.send });
    assert.equal(c.mine().filter((m) => m.to === u.email).length, 0);
  });
});
