// A care team seat only takes a partner's reminders once the person has signed in. An invited login holds
// the seat (it shows in the team list) but cannot see or act on anything yet, so until their first
// sign-in the partner's reminders stay with the missions team instead of going nowhere.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { ownersByPartner, partnersOwnedBy } = require("../../src/utils/ownership");
const { stopServer, removeFixturePartners, FIXTURE_TAG } = require("./helpers");

const MAIL = "route-test-owned-signin";
let originalFeatures;
let missions;
let carer;
let partner;

async function makeUser(tag, extra) {
  return prisma.user.create({
    data: {
      email: `${MAIL}-${tag}@example.test`,
      firstName: tag,
      role: "editor",
      authProvider: "local",
      active: true,
      ...extra,
    },
  });
}

before(async () => {
  await removeFixturePartners();
  await prisma.user.deleteMany({ where: { email: { startsWith: MAIL } } });
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures ?? {};
  const enabledFeatures = { ...originalFeatures, careTeam: true };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
  missions = await makeUser("missions", { onMissionsTeam: true, lastLoginAt: new Date() });
  carer = await makeUser("carer", { passwordHash: null });
  partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: `${FIXTURE_TAG} owned` },
  });
  await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: carer.id } });
});

after(async () => {
  await removeFixturePartners();
  await prisma.user.deleteMany({ where: { email: { startsWith: MAIL } } });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await stopServer();
});

describe("a care team seat takes reminders only after the person has signed in", () => {
  test("an invited carer who has never signed in leaves the partner with the missions team", async () => {
    const owners = await ownersByPartner([partner.id]);
    assert.deepEqual(owners.get(partner.id).includes(missions.id), true);
    assert.equal(owners.get(partner.id).includes(carer.id), false);
    const mine = await partnersOwnedBy(missions.id);
    assert.ok(mine.some((o) => o.partnerId === partner.id && o.via === "missionsTeam"));
  });

  test("once they sign in, the partner is theirs and the missions team steps back", async () => {
    await prisma.user.update({ where: { id: carer.id }, data: { lastLoginAt: new Date() } });
    const owners = await ownersByPartner([partner.id]);
    assert.deepEqual(owners.get(partner.id), [carer.id]);
    const mine = await partnersOwnedBy(missions.id);
    assert.ok(!mine.some((o) => o.partnerId === partner.id));
    const theirs = await partnersOwnedBy(carer.id);
    assert.ok(theirs.some((o) => o.partnerId === partner.id && o.via === "team"));
  });
});
