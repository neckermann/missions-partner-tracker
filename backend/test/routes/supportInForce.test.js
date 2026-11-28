// The Monthly Support page lists each partner's CURRENT amount. "Current" is the amount in force today, the same
// reading the reports use: an entry dated in the future is scheduled, not yet being given, and must not be
// counted (it used to be, so the page's total was higher than the report's).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

const DAY = 86400000;
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

let admin;
let originalFeatures;
let partner;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures ?? {};
  const enabledFeatures = { ...originalFeatures, monthlySupport: true };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
  partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} support in force` },
  });
});

after(async () => {
  await removeFixturePartners();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await removeTestUsers();
  await stopServer();
});

const listed = async () => {
  const res = await admin("/api/partners");
  assert.equal(res.status, 200);
  return res.body.find((p) => p.id === partner.id);
};

describe("the partners list's current support", () => {
  test("is the amount in force today, not a later one dated in the future", async () => {
    await prisma.supportEntry.create({
      data: { partnerId: partner.id, amount: 100, effectiveDate: new Date(ymd(-60)) },
    });
    await prisma.supportEntry.create({
      data: { partnerId: partner.id, amount: 150, effectiveDate: new Date(ymd(-10)) },
    });
    await prisma.supportEntry.create({
      data: { partnerId: partner.id, amount: 400, effectiveDate: new Date(ymd(30)) },
    });
    const row = await listed();
    assert.equal(row.supportEntries.length, 1);
    assert.equal(row.supportEntries[0].amount, 150, "the 400 starts next month");
  });

  test("a partner whose only entry is in the future has none yet", async () => {
    await prisma.supportEntry.deleteMany({ where: { partnerId: partner.id } });
    await prisma.supportEntry.create({
      data: { partnerId: partner.id, amount: 250, effectiveDate: new Date(ymd(14)) },
    });
    const row = await listed();
    assert.deepEqual(row.supportEntries, []);
  });
});
