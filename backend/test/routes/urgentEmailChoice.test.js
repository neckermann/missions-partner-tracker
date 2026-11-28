// An urgent update skips the wait for a schedule, not someone's choice to get no email. Staff who have not
// chosen a digest schedule (cadence null, the default for a new login) are not emailed; those who have are,
// at once. Nothing real is contacted: Postmark is faked.
const { test, describe, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { stopServer, ensureTestUsers, removeTestUsers, FIXTURE_TAG } = require("./helpers");
const { sendUrgentDispatch, countUrgentRecipients } = require("../../src/utils/dispatchOrchestrator");

const realFetch = global.fetch;
let postmarkMessages = [];
global.fetch = (url, options) => {
  const s = String(url);
  if (s.startsWith("https://api.postmarkapp.com")) {
    const sent = options?.body ? JSON.parse(options.body) : [];
    const messages = Array.isArray(sent) ? sent : [sent];
    postmarkMessages.push(...messages);
    const body = messages.map((m) => ({ ErrorCode: 0, Message: "OK", MessageID: "fake-id", To: m.To }));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
  return realFetch(url, options);
};

const TAG = "urgent-email-choice";
const TEXT = "URGENT-email-choice-text";
let originalSettings;
let originalCadences;
let partner;

const to = () => postmarkMessages.map((m) => String(m.To).toLowerCase());

before(async () => {
  await ensureTestUsers();
  originalCadences = await prisma.user.findMany({ select: { id: true, cadence: true } });
  await prisma.user.updateMany({ data: { cadence: null } });
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, postmarkServerToken: true, emailFromAddress: true },
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      enabledFeatures: {
        ...(originalSettings?.enabledFeatures || {}),
        prayerRequests: true,
        outboundEmail: true,
      },
      postmarkServerToken: encryptField("pm-test-token"),
      emailFromAddress: "updates@example.test",
    },
  });
  partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} Urgent Email`, isPublic: true },
  });
  for (const [name, cadence] of [
    ["chose", "monthly"],
    ["none", null],
  ]) {
    await prisma.user.create({
      data: {
        email: `${TAG}-${name}@example.test`,
        role: "editor",
        active: true,
        digestScope: "all",
        cadence,
      },
    });
  }
});

beforeEach(() => {
  postmarkMessages = [];
});

after(async () => {
  global.fetch = realFetch;
  await prisma.dispatchRecord.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
  await Promise.all(
    originalCadences.map((u) =>
      prisma.user.update({ where: { id: u.id }, data: { cadence: u.cadence } }).catch(() => {})
    )
  );
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  await removeTestUsers();
  await stopServer();
});

describe("an urgent update respects who chose to get email", () => {
  test("only logins with a digest schedule are emailed, and the dialog's count agrees", async () => {
    const count = await countUrgentRecipients(partner.id);
    assert.equal(count.adminCount, 1, "only the person who chose email is counted");

    const row = await prisma.dispatchRecord.create({
      data: {
        partnerId: partner.id,
        type: "prayerRequestCreated",
        payload: { partnerName: partner.displayName, requestText: TEXT, category: "strategic" },
      },
    });
    const result = await sendUrgentDispatch(row, { id: partner.id });
    assert.equal(result.emailSent, true);
    assert.equal(result.adminCount, 1);
    assert.ok(to().includes(`${TAG}-chose@example.test`), JSON.stringify(to()));
    assert.ok(!to().includes(`${TAG}-none@example.test`), "someone with no schedule is not emailed");
  });
});
