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

// Link fields take web addresses only (http/https). A script link is refused on the server, whichever
// screen or API call sends it; a bare address is stored with https://.
let admin;
let partnerId;
let originalWebsite;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  originalWebsite = (
    await prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { websiteLink: true } })
  )?.websiteLink;
  await removeFixturePartners();
  const res = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} link schemes` },
  });
  partnerId = res.body.id;
});

after(async () => {
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { websiteLink: originalWebsite ?? null },
  });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

const BAD = [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:x",
  "mailto:a@b.test",
];

describe("partner links", () => {
  for (const url of BAD) {
    test(`refuses ${url.split(":")[0]}: on create`, async () => {
      const res = await admin("/api/partner-links", {
        method: "POST",
        body: { partnerId, type: "website", url },
      });
      assert.equal(res.status, 400);
    });
  }

  test("accepts https and stores a bare address with https://", async () => {
    const ok = await admin("/api/partner-links", {
      method: "POST",
      body: { partnerId, type: "website", url: "https://example.org/about" },
    });
    assert.equal(ok.status, 201);
    const bare = await admin("/api/partner-links", {
      method: "POST",
      body: { partnerId, type: "facebook", url: "facebook.com/somepage" },
    });
    assert.equal(bare.status, 201);
    assert.equal(bare.body.url, "https://facebook.com/somepage");
  });

  test("refuses a script link when changing an existing one", async () => {
    const created = await admin("/api/partner-links", {
      method: "POST",
      body: { partnerId, type: "support", url: "https://example.org/give" },
    });
    const res = await admin(`/api/partner-links/${created.body.id}`, {
      method: "PUT",
      body: { partnerId, type: "support", url: "javascript:alert(1)" },
    });
    assert.equal(res.status, 400);
    const stored = await prisma.partnerLink.findUnique({ where: { id: created.body.id } });
    assert.equal(stored.url, "https://example.org/give");
  });
});

describe("a sending church's website link", () => {
  const put = (sendingChurch) =>
    admin(`/api/partners/${partnerId}`, { method: "PUT", body: { sendingChurch } });

  test("refuses a script link and stores a good one", async () => {
    const bad = await put({ name: "Home Church", websiteLink: "javascript:alert(1)" });
    assert.equal(bad.status, 400);
    const good = await put({ name: "Home Church", websiteLink: "example.org" });
    assert.equal(good.status, 200);
    assert.equal(good.body.sendingChurch.websiteLink, "https://example.org");
    const cleared = await put({ name: "Home Church", websiteLink: "" });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.sendingChurch.websiteLink, null);
  });
});

describe("the church's own website link", () => {
  test("refuses a script link", async () => {
    const res = await admin("/api/settings", { method: "PUT", body: { websiteLink: "javascript:alert(1)" } });
    assert.equal(res.status, 400);
    const ok = await admin("/api/settings", { method: "PUT", body: { websiteLink: "https://example.org" } });
    assert.equal(ok.status, 200);
  });
});

describe("trip link fields", () => {
  let originalFeatures;
  before(async () => {
    originalFeatures = (
      await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      })
    )?.enabledFeatures;
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { ...(originalFeatures || {}), trips: true } },
    });
  });
  after(async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: originalFeatures ?? {} },
    });
  });

  test("the online giving address refuses a script link", async () => {
    const bad = await admin("/api/settings/trips", {
      method: "PUT",
      body: { onlineGivingUrl: "javascript:alert(1)" },
    });
    assert.equal(bad.status, 400);
    const ok = await admin("/api/settings/trips", {
      method: "PUT",
      body: { onlineGivingUrl: "https://example.org/give" },
    });
    assert.equal(ok.status, 200);
    await admin("/api/settings/trips", { method: "PUT", body: { onlineGivingUrl: null } });
  });

  test("a trip's photo album and a meeting's link refuse a script link", async () => {
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId, type: "Construction", startDate: "2027-03-01", endDate: "2027-03-08" },
    });
    assert.equal(trip.status, 201);
    const wrapUp = (albumUrl) =>
      admin(`/api/trips/${trip.body.id}/wrap-up`, {
        method: "POST",
        body: { albumProvider: "other", albumUrl },
      });
    assert.equal((await wrapUp("javascript:alert(1)")).status, 400);
    assert.equal((await wrapUp("https://example.org/album")).status, 200, "a real album link is accepted");
    const meeting = await admin(`/api/trips/${trip.body.id}/meetings`, {
      method: "POST",
      body: { meetingLink: "javascript:alert(1)", startAt: "2027-02-01T18:00:00.000Z" },
    });
    assert.equal(meeting.status, 400);
    const fine = await admin(`/api/trips/${trip.body.id}/meetings`, {
      method: "POST",
      body: { meetingLink: "https://example.org/call", startAt: "2027-02-01T18:00:00.000Z" },
    });
    assert.equal(
      fine.status,
      201,
      "the same meeting with a real link is accepted, so only the link was wrong"
    );
  });
});
