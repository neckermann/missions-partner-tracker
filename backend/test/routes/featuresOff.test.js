// A church may leave any optional feature off. With every optional feature switched off, the core
// still works (partners, settings, the bell, reports), every feature-gated endpoint answers "not
// found" rather than erroring, and nothing returns a server error. This is the guard behind "build
// everything with features off in mind": add a new gated endpoint to GATED below.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { FEATURE_KEYS } = require("../../src/utils/features");
const { client, stopServer, ensureTestUsers, removeFixturePartners, FIXTURE_TAG } = require("./helpers");

// Paths that must work with every optional feature off.
const CORE = ["/api/partners", "/api/settings", "/api/notifications/summary"];

// Paths that belong to one feature (and must say "not found" while it is off).
const GATED = [
  "/api/contact-log/options",
  "/api/contact-log/all",
  "/api/contact-log/assigned",
  "/api/surveys",
  "/api/survey-updates",
  "/api/support-preferences/kinds",
  "/api/audit",
  "/api/care-team/candidates",
];

let admin;
let originalEnabledFeatures;
let partner;

async function setAll(on) {
  const enabledFeatures = Object.fromEntries(FEATURE_KEYS.map((k) => [k, on]));
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await removeFixturePartners();
  partner = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} allOff` },
    })
  ).body;
});

after(async () => {
  await removeFixturePartners();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("every optional feature off", () => {
  test("the core still works", async () => {
    await setAll(false);
    for (const path of CORE) {
      const res = await admin(path);
      assert.equal(res.status, 200, `${path} should work with every feature off (got ${res.status})`);
    }
    const one = await admin(`/api/partners/${partner.id}`);
    assert.equal(one.status, 200);
  });

  test("a gated endpoint says not found, never a server error", async () => {
    await setAll(false);
    for (const path of GATED) {
      const res = await admin(path);
      assert.ok(res.status < 500, `${path} errored with ${res.status}`);
      assert.equal(res.status, 404, `${path} should be 404 with its feature off (got ${res.status})`);
    }
  });

  test("the partner's own endpoints and the notification list hold up", async () => {
    await setAll(false);
    for (const path of [
      `/api/contact-log?partnerId=${partner.id}`,
      `/api/contact-log/timeline?partnerId=${partner.id}`,
      `/api/contact-log/updates?partnerId=${partner.id}`,
      `/api/support-preferences/partner/${partner.id}`,
      `/api/care-team/${partner.id}`,
      `/api/prayer-requests?partnerId=${partner.id}`,
      `/api/partner-files?partnerId=${partner.id}`,
      `/api/support-entries?partnerId=${partner.id}`,
      "/api/trips",
    ]) {
      const res = await admin(path);
      assert.ok(res.status < 500, `${path} errored with ${res.status}`);
    }
    const bell = await admin("/api/notifications/summary");
    assert.equal(bell.status, 200);
  });

  test("with everything on, the same gated endpoints answer", async () => {
    await setAll(true);
    for (const path of ["/api/contact-log/options", "/api/surveys", "/api/survey-updates"]) {
      const res = await admin(path);
      assert.equal(res.status, 200, `${path} should work with its feature on (got ${res.status})`);
    }
  });
});
