// B7 at the database: the bell, the daily email and the care posts all read the open key dates through
// loadOpenKeyDates, whose "today" now defaults to the church's own day. Time is faked at the moment that
// used to give the wrong day, in a zone east of UTC and one west of it.
const { test, describe, before, after, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { loadOpenKeyDates } = require("../../src/utils/keyDateQueries");
const { applyChurchTimezone } = require("../../src/utils/timezone");

const TAG = "ZZTEST-keyDateChurchDay";
const originalTz = process.env.TZ;
let partner;
let user;
let originalFeatures;

before(async () => {
  const current = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  originalFeatures = current?.enabledFeatures ?? null;
  const features = { ...(current?.enabledFeatures || {}), keyDates: true, careTeam: false };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures: features },
    create: { id: "singleton", enabledFeatures: features },
  });
  user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, role: "editor", active: true, onMissionsTeam: true },
  });
  partner = await prisma.partner.create({
    data: {
      kind: "missionary",
      displayName: `${TAG} Family`,
      isPublic: false,
      // A birthday on the 27th: "today" in Sydney at the moment below, "tomorrow" in Los Angeles.
      adults: { create: { firstName: "Alex", birthday: new Date("1990-11-27T00:00:00Z") } },
    },
  });
});

afterEach(() => {
  mock.timers.reset();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

after(async () => {
  await prisma.partner.deleteMany({ where: { displayName: { contains: TAG } } });
  await prisma.user.deleteMany({ where: { email: `${TAG}@example.test` } });
  await prisma.churchSettings.updateMany({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await prisma.$disconnect();
});

const mine = (items) => items.filter((i) => i.partnerId === partner.id && i.kind === "birthday");

describe("key dates use the church's own day", () => {
  test("in Sydney at 7am on the 27th (still the 26th in UTC), a birthday on the 27th is today", async () => {
    applyChurchTimezone("Australia/Sydney");
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-26T20:00:00Z") });
    const [item] = mine(await loadOpenKeyDates());
    assert.ok(item, "the birthday is open");
    assert.equal(item.daysUntil, 0);
  });

  test("in Los Angeles on the evening of the 26th (already the 27th in UTC), it is still tomorrow", async () => {
    applyChurchTimezone("America/Los_Angeles");
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-27T03:00:00Z") });
    const [item] = mine(await loadOpenKeyDates());
    assert.ok(item);
    assert.equal(item.daysUntil, 1);
  });
});
