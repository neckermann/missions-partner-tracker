// The Sunday prayer sheet: GET /api/prayer-sheet. It is handed out, so only what the public site may show can
// appear: a public, unrestricted, unarchived partner, and only its strategic, explicitly public, ongoing requests.
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

let admin;
let viewer;
let anon;
let originalFeatures;
const names = {};

const nameOf = (tag) => `${FIXTURE_TAG} sheet ${tag}`;
const ours = (partners) => partners.filter((p) => p.displayName.startsWith(`${FIXTURE_TAG} sheet `));
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

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

async function makePartner(tag, data = {}, requests = [{}]) {
  const partner = await prisma.partner.create({
    data: { kind: "missionary", displayName: nameOf(tag), isPublic: true, ...data },
  });
  for (const [i, r] of requests.entries()) {
    await prisma.prayerRequest.create({
      data: {
        partnerId: partner.id,
        category: "strategic",
        isPublic: true,
        status: "ongoing",
        requestText: `${tag} request ${i + 1}`,
        dateReceived: new Date(Date.UTC(2026, 0, 1 + i)),
        ...r,
      },
    });
  }
  names[tag] = partner.displayName;
  return partner;
}

before(async () => {
  await ensureTestUsers();
  [admin, viewer, anon] = await Promise.all([client("admin"), client("viewer"), client(null)]);
  await removeFixturePartners();
  originalFeatures = (
    await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { enabledFeatures: true } })
  )?.enabledFeatures;
  await setFeatures({ prayerRequests: true });

  // Eligible
  await makePartner("good-a", {}, [{}, {}, {}, {}, {}]); // five requests, to test the cap
  await makePartner("good-b");
  await makePartner("good-c");
  await makePartner("good-d");
  // Not eligible, each for its own reason
  await makePartner("restricted", { isRestricted: true });
  await makePartner("archived", { archived: true });
  await makePartner("not-public", { isPublic: false });
  await makePartner("situational-only", {}, [{ category: "situational" }]);
  await makePartner("private-request-only", {}, [{ isPublic: false }]);
  await makePartner("answered-only", {}, [{ status: "answered" }]);
  await makePartner("no-requests", {}, []);
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures ?? {} },
  });
  await stopServer();
});

const sheet = (query, who = admin) => who(`/api/prayer-sheet?${new URLSearchParams(query)}`);

describe("who and what may be on the sheet", () => {
  test("only public, unrestricted, unarchived partners with a public strategic ongoing request", async () => {
    const res = await sheet({ date: "2026-12-06", cadence: "monthly" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const shown = ours(res.body.partners).map((p) => p.displayName);
    assert.deepEqual(shown.sort(), ["good-a", "good-b", "good-c", "good-d"].map((t) => names[t]).sort());
  });

  test("a restricted partner, an archived one, and a private one never appear, nor does their text", async () => {
    const res = await sheet({ date: "2026-12-06", cadence: "monthly" });
    const text = JSON.stringify(res.body);
    for (const tag of [
      "restricted",
      "archived",
      "not-public",
      "situational-only",
      "private-request-only",
      "answered-only",
    ]) {
      assert.ok(!text.includes(names[tag]), `${tag} partner must not appear`);
      assert.ok(!text.includes(`${tag} request`), `${tag} request text must not appear`);
    }
  });

  test("each partner shows its newest requests up to the cap, and says how many more there are", async () => {
    const res = await sheet({ date: "2026-12-06", cadence: "monthly" });
    const a = res.body.partners.find((p) => p.displayName === names["good-a"]);
    assert.equal(a.requests.length, 3, "three by default");
    assert.equal(a.moreRequests, 2);
    assert.equal(a.requests[0].text, "good-a request 5", "newest first");
    const capped = await sheet({ date: "2026-12-06", cadence: "monthly", perPartner: "5" });
    assert.equal(capped.body.partners.find((p) => p.displayName === names["good-a"]).requests.length, 5);
  });

  test("the response carries nothing but what is needed to print", async () => {
    const res = await sheet({ date: "2026-12-06", cadence: "monthly" });
    const p = res.body.partners.find((x) => x.displayName === names["good-b"]);
    assert.deepEqual(Object.keys(p).sort(), [
      "country",
      "displayName",
      "id",
      "kind",
      "moreRequests",
      "requests",
    ]);
    assert.deepEqual(Object.keys(p.requests[0]).sort(), ["id", "text"]);
  });
});

describe("the rotation", () => {
  test("weekly: four consecutive Sundays show every eligible partner exactly once", async () => {
    const seen = [];
    for (let week = 0; week < 4; week += 1) {
      const res = await sheet({ date: addDays("2026-12-06", week * 7), cadence: "weekly" });
      assert.equal(res.body.group.count, 4);
      seen.push(...ours(res.body.partners).map((p) => p.displayName));
    }
    assert.deepEqual(seen.sort(), ["good-a", "good-b", "good-c", "good-d"].map((t) => names[t]).sort());
  });

  test("biweekly: two consecutive sheets show everyone once", async () => {
    const seen = [];
    for (let sheetNo = 0; sheetNo < 2; sheetNo += 1) {
      const res = await sheet({ date: addDays("2026-12-06", sheetNo * 14), cadence: "biweekly" });
      assert.equal(res.body.group.count, 2);
      seen.push(...ours(res.body.partners).map((p) => p.displayName));
    }
    assert.deepEqual(seen.sort(), ["good-a", "good-b", "good-c", "good-d"].map((t) => names[t]).sort());
  });

  test("the same date gives the same sheet, and the total is reported so the page can say 'x of y'", async () => {
    const one = await sheet({ date: "2026-12-13", cadence: "weekly" });
    const two = await sheet({ date: "2026-12-13", cadence: "weekly" });
    assert.deepEqual(one.body, two.body);
    assert.ok(one.body.totalPartners >= 4);
  });
});

describe("access and input", () => {
  test("needs a sign-in, and a viewer can read it", async () => {
    assert.equal((await sheet({ date: "2026-12-06" }, anon)).status, 401);
    assert.equal((await sheet({ date: "2026-12-06" }, viewer)).status, 200);
  });

  test("is not there when prayer requests are switched off", async () => {
    await setFeatures({ prayerRequests: false });
    try {
      assert.equal((await sheet({ date: "2026-12-06" })).status, 404);
    } finally {
      await setFeatures({ prayerRequests: true });
    }
  });

  test("a bad date, cadence or count is refused", async () => {
    assert.equal((await sheet({ cadence: "weekly" })).status, 400, "no date");
    assert.equal((await sheet({ date: "2026-02-30" })).status, 400);
    assert.equal((await sheet({ date: "2026-12-06", cadence: "daily" })).status, 400);
    assert.equal((await sheet({ date: "2026-12-06", perPartner: "0" })).status, 400);
    assert.equal((await sheet({ date: "2026-12-06", perPartner: "6" })).status, 400);
  });

  test("the cadence defaults to weekly", async () => {
    const res = await sheet({ date: "2026-12-06" });
    assert.equal(res.body.cadence, "weekly");
  });
});
