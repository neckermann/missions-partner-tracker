// G14e: a scheduled report that fails for one recipient used to throw out of the loop, so the recipients after
// them were skipped and the whole report was sent again to the earlier ones at the next send hour. Each recipient
// is now sent on their own (and tried twice); the report is marked sent as long as anyone got it, and left due
// when nobody did.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { sendDueReports } = require("../../src/utils/reportScheduler");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let owner;
const recipients = {};
let originalFeatures;

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

async function makeUser(tag, role = "editor") {
  const email = `route-test-report-send-${tag}@example.test`;
  return prisma.user.upsert({
    where: { email },
    update: { active: true, role },
    create: {
      email,
      passwordHash: await bcrypt.hash("RouteTestReport123!", 4),
      role,
      authProvider: "local",
      active: true,
    },
  });
}

// Postmark answers `answer(toAddress)`; every attempt is recorded.
async function withPostmark(answer, run) {
  const attempts = [];
  const prevFetch = global.fetch;
  global.fetch = (url, options) => {
    if (String(url).startsWith("https://api.postmarkapp.com") && options?.body) {
      let to = null;
      try {
        to = JSON.parse(options.body).To;
      } catch {
        /* not a send */
      }
      attempts.push(to);
      const ok = answer(to);
      const body = ok
        ? { MessageID: "fake-id", SubmittedAt: "2026-01-01T00:00:00Z", ErrorCode: 0 }
        : { ErrorCode: 300, Message: "Provider unavailable" };
      return Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
    }
    return prevFetch(url, options);
  };
  try {
    await run();
  } finally {
    global.fetch = prevFetch;
  }
  return attempts;
}

async function scheduleFor(userIds) {
  const view = await prisma.savedReport.create({
    data: { reportId: "prayer-requests", name: "report-send-test", params: {}, ownerId: owner.id },
  });
  return prisma.reportSchedule.create({
    data: { savedReportId: view.id, cadence: "weekly", recipientIds: userIds, skipIfEmpty: false },
  });
}
const lastSent = async (schedule) =>
  (await prisma.reportSchedule.findUnique({ where: { id: schedule.id } })).lastSentAt;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  originalFeatures = (
    await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { enabledFeatures: true } })
  )?.enabledFeatures;
  await setFeatures({ reports: true, outboundEmail: true, prayerRequests: true });
  await admin("/api/settings/email", {
    method: "PUT",
    body: { sendEnabled: true, serverToken: "pm-test-token", fromAddress: "updates@example.test" },
  });
  owner = await makeUser("owner", "admin");
  for (const tag of ["a", "b", "c"]) recipients[tag] = await makeUser(tag);
});

after(async () => {
  await prisma.reportSchedule.deleteMany({ where: { savedReport: { ownerId: owner.id } } });
  await prisma.savedReport.deleteMany({ where: { ownerId: owner.id } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "route-test-report-send-" } },
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures ?? {} },
  });
  await removeTestUsers();
  await stopServer();
});

const ours = (attempts) => attempts.filter((to) => to?.startsWith("route-test-report-send-"));

describe("a scheduled report that fails for one recipient", () => {
  test("still goes to the rest, is marked sent, and is not sent again to the ones who have it", async () => {
    const schedule = await scheduleFor([recipients.a.id, recipients.b.id, recipients.c.id]);
    const badAddress = recipients.b.email;
    const first = await withPostmark(
      (to) => to !== badAddress,
      () => sendDueReports()
    );
    const sentTo = ours(first);
    assert.ok(
      sentTo.includes(recipients.a.email) && sentTo.includes(recipients.c.email),
      "the others still got it"
    );
    assert.ok((await lastSent(schedule)) !== null, "marked sent: someone got it");

    // The next send hour: the schedule is not due again until its cadence has passed.
    const next = await withPostmark(
      () => true,
      () => sendDueReports()
    );
    assert.equal(ours(next).length, 0, "nobody is sent it a second time");
  });

  test("a hiccup on the first try is retried once, so that recipient still gets it", async () => {
    const schedule = await scheduleFor([recipients.a.id]);
    let failedOnce = false;
    const attempts = await withPostmark(
      (to) => {
        if (to === recipients.a.email && !failedOnce) {
          failedOnce = true;
          return false;
        }
        return true;
      },
      () => sendDueReports()
    );
    assert.equal(ours(attempts).filter((to) => to === recipients.a.email).length, 2, "tried twice");
    assert.ok((await lastSent(schedule)) !== null);
  });

  test("when nobody could be sent it, it is left due so the next send hour tries again", async () => {
    const schedule = await scheduleFor([recipients.a.id, recipients.b.id]);
    await withPostmark(
      () => false,
      () => sendDueReports()
    );
    assert.equal(await lastSent(schedule), null, "not marked sent");
    const later = await withPostmark(
      () => true,
      () => sendDueReports()
    );
    assert.deepEqual(ours(later).sort(), [recipients.a.email, recipients.b.email].sort());
    assert.ok((await lastSent(schedule)) !== null);
  });
});
