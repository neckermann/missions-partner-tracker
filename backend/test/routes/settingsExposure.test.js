// GET /api/settings must use an explicit `select`, not a denylist: with an `omit` of the
// secret columns, every other column went to any signed-in role, Trip Leader included
// (inboundEmailWebhookUsername, inboundEmailAddress, GroupMe group/topic ids, WhatsApp
// community/group JIDs). This confirms those fields are gone from the response and that the
// route still returns real content (not an accidentally empty allowlist).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { encryptField } = require("../../src/utils/crypto");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let editor;
let originalSettings;

before(async () => {
  await ensureTestUsers();
  editor = await client("editor");

  originalSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });

  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: {
      churchName: "Hillside Community Church",
      inboundEmailWebhookUsername: "route-test-webhook-user",
      inboundEmailAddress: "receive@updates.example.test",
      groupmeGroupId: "12345678",
      groupmeGroupName: "Our Church Group",
      groupmePrayerTopicId: "99",
      groupmePrayerTopicName: "Prayer",
      whatsappCommunityId: "100@g.us",
      whatsappCommunityName: "Our Church Community",
      whatsappPrayerGroupId: "200@g.us",
      whatsappPrayerGroupName: "Prayer Group",
      whatsappLastError: "connection reset",
      joshuaProjectApiKey: encryptField("jp-test-key"),
    },
    create: {
      id: "singleton",
      churchName: "Hillside Community Church",
      inboundEmailWebhookUsername: "route-test-webhook-user",
      inboundEmailAddress: "receive@updates.example.test",
      groupmeGroupId: "12345678",
      groupmeGroupName: "Our Church Group",
      groupmePrayerTopicId: "99",
      groupmePrayerTopicName: "Prayer",
      whatsappCommunityId: "100@g.us",
      whatsappCommunityName: "Our Church Community",
      whatsappPrayerGroupId: "200@g.us",
      whatsappPrayerGroupName: "Prayer Group",
      whatsappLastError: "connection reset",
      joshuaProjectApiKey: encryptField("jp-test-key"),
    },
  });
});

after(async () => {
  await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings ?? {} });
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/settings -- field exposure (#327 Finding 9)", () => {
  test("GroupMe/WhatsApp internal ids and names are never in the response", async () => {
    const res = await editor("/api/settings");
    assert.equal(res.status, 200);
    const raw = JSON.stringify(res.body);
    for (const field of [
      "groupmeGroupId",
      "groupmeGroupName",
      "groupmePrayerTopicId",
      "groupmePrayerTopicName",
      "whatsappCommunityId",
      "whatsappCommunityName",
      "whatsappPrayerGroupId",
      "whatsappPrayerGroupName",
      "whatsappLastError",
    ]) {
      assert.ok(!(field in res.body), `${field} must not be a key in the response`);
    }
    // Also confirm the actual values never leak under some other key.
    assert.ok(!raw.includes("12345678"));
    assert.ok(!raw.includes("Our Church Group"));
    assert.ok(!raw.includes("connection reset"));
  });

  test("inboundEmailWebhookUsername and inboundEmailAddress are never in the response", async () => {
    const res = await editor("/api/settings");
    assert.ok(!("inboundEmailWebhookUsername" in res.body));
    assert.ok(!("inboundEmailAddress" in res.body));
    assert.ok(!JSON.stringify(res.body).includes("route-test-webhook-user"));
  });

  test("the response still returns real, expected content -- not an accidentally-empty allowlist", async () => {
    const res = await editor("/api/settings");
    assert.equal(res.body.churchName, "Hillside Community Church");
    assert.ok("enabledFeatures" in res.body);
    assert.ok("featureRegistry" in res.body);
    assert.ok("sentByOurChurchCount" in res.body);
  });

  test("returns the two sign-in policy switches as booleans (#402)", async () => {
    const res = await editor("/api/settings");
    assert.equal(typeof res.body.requireTwoFactor, "boolean");
    assert.equal(typeof res.body.requirePasswordless, "boolean");
  });
});
