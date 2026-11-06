const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

// maskData.test.js covers the serializer as a pure function. These cover
// the boundary itself: that the public routes actually run everything
// through it, that non-public records never appear at all, and that a
// restricted record's real details don't survive the round trip. A masking
// function that's correct but bypassed by one route would pass those unit
// tests and fail these.

let admin;
let anon;

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

async function createPartner(overrides) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} Jordan Rivera`,
      overview: "SECRET-OVERVIEW-TEXT",
      websiteLink: "https://secret.example.com",
      addresses: { physical: { country: "Thailand", gpsLat: 13.75, gpsLng: 100.5 } },
      ...overrides,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe("public partners: visibility", () => {
  test("the public endpoints need no session", async () => {
    assert.equal((await anon("/api/public/partners")).status, 200);
  });

  test("a non-public partner is absent from the list and 404s by id", async () => {
    const p = await createPartner({ isPublic: false });
    const list = await anon("/api/public/partners");
    assert.ok(!list.body.some((r) => r.id === p.id), "private partner must not be listed");
    assert.equal((await anon(`/api/public/partners/${p.id}`)).status, 404);
  });

  test("an archived partner is absent even if it was public", async () => {
    const p = await createPartner({ isPublic: true });
    await admin(`/api/partners/${p.id}/archive`, { method: "POST" });
    const list = await anon("/api/public/partners");
    assert.ok(!list.body.some((r) => r.id === p.id));
    assert.equal((await anon(`/api/public/partners/${p.id}`)).status, 404);
  });
});

describe("public partners: masking is applied by the route, not just available", () => {
  test("a public non-restricted partner exposes its real name and precise pin", async () => {
    const p = await createPartner({ isPublic: true });
    const { body } = await anon(`/api/public/partners/${p.id}`);
    assert.equal(body.displayName, `${FIXTURE_TAG} Jordan Rivera`);
    assert.equal(body.gpsLat, 13.75);
    assert.equal(body.overview, "SECRET-OVERVIEW-TEXT");
  });

  test("a restricted partner leaks neither name, overview, links nor precise location", async () => {
    const p = await createPartner({ isPublic: true, isRestricted: true });
    const { body } = await anon(`/api/public/partners/${p.id}`);

    assert.notEqual(body.displayName, `${FIXTURE_TAG} Jordan Rivera`);
    assert.ok(
      !JSON.stringify(body).includes("SECRET-OVERVIEW-TEXT"),
      "the real overview must not appear anywhere in the response"
    );
    assert.ok(
      !JSON.stringify(body).includes("secret.example.com"),
      "links must not appear anywhere in the response"
    );
    assert.notEqual(body.gpsLat, 13.75, "the precise serving-location pin must be replaced");
    assert.equal(body.gpsLat, 15, "restricted records get the country centroid instead");
    assert.ok(body.photo.startsWith("data:image/svg+xml,"), "restricted records get a generic silhouette");
  });

  // The rule changed during the rebuild: organizations used to keep their
  // name when restricted. A named Christian organization in a hostile
  // country is a fixed, locatable target, so both kinds are masked now.
  test("a restricted organization is masked to initials, same as a missionary", async () => {
    const p = await createPartner({
      kind: "organization",
      orgType: "Local",
      displayName: `${FIXTURE_TAG} Example Relief Org`,
      isPublic: true,
      isRestricted: true,
    });
    const { body } = await anon(`/api/public/partners/${p.id}`);
    assert.notEqual(body.displayName, `${FIXTURE_TAG} Example Relief Org`);
    // Assert the security property rather than the exact format: none of
    // the name's actual words may survive. (Checking for a strict
    // initials-only string would trip over the fixture tag, which
    // toInitials abbreviates along with everything else.)
    for (const word of ["Example", "Relief", "Org"]) {
      assert.ok(!body.displayName.includes(word), `"${word}" leaked through as ${body.displayName}`);
    }
    assert.ok(body.displayName.includes("E.R.O."), `expected initials, got ${body.displayName}`);
  });

  test("admin-only collections never appear on a public record", async () => {
    const p = await createPartner({ isPublic: true });
    await admin("/api/support-entries", {
      method: "POST",
      body: { partnerId: p.id, amount: 500, effectiveDate: "2026-01-01" },
    });

    const { body } = await anon(`/api/public/partners/${p.id}`);
    assert.ok(!("supportEntries" in body), "support history is admin-only");
    assert.ok(!("needRequests" in body), "one-time needs are admin-only");
    assert.ok(!("prayerRequests" in body), "prayer requests are admin-only on the public site");
  });
});
