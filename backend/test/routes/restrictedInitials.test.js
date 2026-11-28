// A restricted missionary household is shown outside the signed-in app as its adults' initials ("T.S. and S.S."),
// never its real names and not initials of the display name ("T.A.S.S."). One test per place a restricted partner's
// name can surface, each against the real database and the same loaders the app uses, so a place that forgets to
// load the adults shows up here.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const prisma = require("../../src/prismaClient");
const { buildBlurb, DISPATCH_PARTNER_SELECT } = require("../../src/utils/dispatchBlurbs");
const { partnerFieldLabel, tripPartnerSelect } = require("../../src/utils/publicTripShared");
const { describe: describeKeyDate } = require("../../src/utils/keyDateReminderEmail");
const { loadOpenKeyDates } = require("../../src/utils/keyDateQueries");
const { runReport, getReport } = require("../../src/reporting/registry");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
  TEST_USERS,
} = require("./helpers");

const NAME = `${FIXTURE_TAG} Tim and Sarah Smith`;
const REAL = /Tim|Sarah|Smith/;
// Reports list every partner, and the seed has other Sarahs; only this household's own name must be absent there.
const REAL_NAME = /Tim and Sarah Smith|Tim Smith|Sarah Smith/;
let anon;
let partner;
let originalFeatures;
let originalTeam;

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

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ publicDirectory: true, keyDates: true, trips: true });
  const soon = new Date();
  soon.setUTCDate(soon.getUTCDate() + 3);
  partner = await prisma.partner.create({
    data: {
      kind: "missionary",
      displayName: NAME,
      isPublic: true,
      isRestricted: true,
      anniversary: soon,
      adults: {
        create: [
          { firstName: "Tim", lastName: "Smith", isPrimaryContact: true },
          { firstName: "Sarah", lastName: "Smith" },
        ],
      },
    },
  });
  // A key date goes to whoever looks after the partner (here the missions team), so the test admin joins it.
  originalTeam = await prisma.user.findMany({
    where: { onMissionsTeam: true },
    select: { id: true, email: true },
  });
  await prisma.user.updateMany({ where: { email: TEST_USERS.admin.email }, data: { onMissionsTeam: true } });
});

after(async () => {
  await prisma.user.updateMany({
    where: { email: TEST_USERS.admin.email },
    data: { onMissionsTeam: originalTeam.some((u) => u.email === TEST_USERS.admin.email) },
  });
  await prisma.churchSettings.updateMany({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

// The fixture's display name carries the test tag, so "initials of the display name" would include the tag's words.
const EXPECTED = "T.S. and S.S.";
const ACCESS = { role: "admin", isEnabled: () => true };

describe("restricted initials, everywhere a restricted partner's name appears", () => {
  test("the public site: the detail page and the list name the household by its adults' initials, and no real name appears", async () => {
    const detail = await anon(`/api/public/partners/${partner.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.displayName, EXPECTED);
    assert.doesNotMatch(JSON.stringify(detail.body), REAL);

    const list = await anon("/api/public/partners");
    const mine = list.body.find((p) => p.id === partner.id);
    assert.equal(mine.displayName, EXPECTED);
    assert.doesNotMatch(JSON.stringify(mine), REAL);
  });

  test("a dispatch (GroupMe, WhatsApp, email): the blurb uses the adults' initials, loaded with the shared dispatch select", async () => {
    const loaded = await prisma.partner.findUnique({
      where: { id: partner.id },
      select: DISPATCH_PARTNER_SELECT,
    });
    const row = {
      id: "r1",
      type: "prayerRequestCreated",
      partnerId: partner.id,
      payload: { partnerName: NAME, requestText: "Pray for them", category: "strategic" },
      dispatchReviewedAt: null,
    };
    const blurb = buildBlurb(row, loaded);
    assert.match(blurb.groupmeText, /T\.S\. and S\.S\./);
    assert.doesNotMatch(JSON.stringify(blurb), REAL);
  });

  test("a key-date reminder names the household by the adults' initials", async () => {
    const items = await loadOpenKeyDates();
    const item = items.find((i) => i.partnerId === partner.id);
    assert.ok(item, "the restricted household has an upcoming key date for this test");
    const line = describeKeyDate(item, undefined);
    assert.ok(line.startsWith(`${EXPECTED}:`), line);
    assert.doesNotMatch(line, REAL);
  });

  test("a public trip's field name for a restricted partner is the adults' initials, loaded with the trip select", async () => {
    const trip = await prisma.trip.create({
      data: { name: `${FIXTURE_TAG} initials trip`, status: "planning", partnerId: partner.id },
    });
    try {
      const loaded = await prisma.trip.findUnique({
        where: { id: trip.id },
        select: { id: true, ...tripPartnerSelect },
      });
      assert.equal(partnerFieldLabel(loaded.partner, undefined), EXPECTED);
    } finally {
      await prisma.trip.delete({ where: { id: trip.id } });
    }
  });

  test("a report that leaves the app (the shared audience) shows the adults' initials, and the signed-in admin still sees the name", async () => {
    const report = getReport("partner-roster", ACCESS);
    const shared = await runReport(
      report,
      { includeArchived: "false" },
      { prisma, today: new Date(), audience: "shared" }
    );
    const row = shared.rows.find((r) => r.partnerName === EXPECTED);
    assert.ok(row, "the restricted household is in the shared report under its initials");
    assert.doesNotMatch(JSON.stringify(shared.rows), REAL_NAME);

    const admin = await runReport(report, {}, { prisma, today: new Date(), audience: "admin" });
    assert.ok(
      admin.rows.some((r) => r.partnerName === NAME),
      "signed-in staff still see the real name"
    );
  });

  test("with initials switched off every place uses the generic label, never an adult", async () => {
    const off = { restrictedPartnerInitialsEnabled: false };
    const report = getReport("partner-roster", ACCESS);
    const shared = await runReport(
      report,
      {},
      { prisma, today: new Date(), audience: "shared", settings: off }
    );
    assert.ok(shared.rows.some((r) => r.partnerName === "A restricted-access partner"));
    assert.doesNotMatch(JSON.stringify(shared.rows), REAL_NAME);
  });
});

describe("a guard so no loader forgets the adults", () => {
  const src = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "src", file), "utf8");

  test("every place that loads a partner to name it by its initials includes the adults", () => {
    // utils/dispatchBlurbs.js defines the shared select used by groupmeChannel, whatsappChannel and
    // emailDispatchDelivery; the others spread MASK_NAME_SELECT themselves (or load the adults' names directly).
    for (const file of [
      "utils/groupmeChannel.js",
      "utils/whatsappChannel.js",
      "utils/emailDispatchDelivery.js",
    ]) {
      assert.match(
        src(file),
        /DISPATCH_PARTNER_SELECT/,
        `${file} must load partners with DISPATCH_PARTNER_SELECT`
      );
    }
    assert.match(src("utils/dispatchBlurbs.js"), /\.\.\.MASK_NAME_SELECT/);
    assert.match(src("utils/publicTripShared.js"), /\.\.\.MASK_NAME_SELECT/);
    assert.match(src("routes/publicPartners.js"), /withMaskNames/);
    assert.match(src("reporting/registry.js"), /restrictedInitialsByName/);
    assert.match(src("utils/keyDateQueries.js"), /isPrimaryContact: true/);
  });
});
