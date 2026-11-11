const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const whatsappClient = require("../../src/utils/whatsappClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

// No real WhatsApp anywhere: whatsappClient's seams (`_deps`) are swapped
// for a fake Baileys module whose socket is an EventEmitter the tests
// drive by hand, a no-op advisory lock, and an identity anti-ban wrapper.
// Everything else -- the routes, the feature gate, the encrypted DB-backed
// auth state, the settings columns -- is the real thing against a real DB.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, { timeoutMs = 3000 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await sleep(25);
  }
}

let realBaileys;
let sockets;
function makeFakeSocket() {
  const ev = new EventEmitter();
  const sock = {
    ev,
    user: { id: "15551234567:9@s.whatsapp.net" },
    sent: [],
    loggedOut: false,
    ended: false,
    requestPairingCode: async () => "ABCD1234",
    sendMessage: async (jid, content) => sock.sent.push({ jid, content }),
    groupFetchAllParticipating: async () => ({
      "100@g.us": { id: "100@g.us", subject: "Our Church Community", isCommunity: true },
      "999@g.us": { id: "999@g.us", subject: "Some Plain Group", isCommunity: false },
    }),
    communityFetchLinkedGroups: async () => ({
      linkedGroups: [
        { id: "111@g.us", subject: "Prayer" },
        { id: "222@g.us", subject: "One-time Needs" },
        { id: "333@g.us", subject: "Newsletters" },
      ],
    }),
    logout: async () => {
      sock.loggedOut = true;
    },
    end: () => {
      sock.ended = true;
    },
  };
  return sock;
}

let admin;
let editor;
let unauthenticated;
let originalSettings;
const SETTINGS_COLUMNS = {
  enabledFeatures: true,
  whatsappPhoneNumber: true,
  whatsappPairedAt: true,
  whatsappCommunityId: true,
  whatsappCommunityName: true,
  whatsappPrayerGroupId: true,
  whatsappPrayerGroupName: true,
  whatsappOneTimeNeedGroupId: true,
  whatsappOneTimeNeedGroupName: true,
  whatsappNewsletterGroupId: true,
  whatsappNewsletterGroupName: true,
};

async function setWhatsAppFeature(enabled) {
  const row = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: { ...(row?.enabledFeatures || {}), whatsapp: enabled } },
  });
}

before(async () => {
  realBaileys = await import("baileys");
  sockets = [];
  whatsappClient._deps.loadBaileys = async () => ({
    ...realBaileys,
    default: () => {
      const sock = makeFakeSocket();
      sockets.push(sock);
      return sock;
    },
  });
  whatsappClient._deps.loadAntiban = () => ({
    wrapSocket: (sock) => {
      sock.antiban = { getStats: () => ({ health: { risk: "low", recommendation: "All good" } }) };
      return sock;
    },
  });
  whatsappClient._deps.acquireLock = async () => true;
  whatsappClient._deps.releaseLock = async () => {};
  whatsappClient._deps.fetchVersion = null;

  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  unauthenticated = await client();

  await prisma.churchSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });
  originalSettings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: SETTINGS_COLUMNS,
  });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      whatsappPhoneNumber: null,
      whatsappPairedAt: null,
      whatsappCommunityId: null,
      whatsappCommunityName: null,
      whatsappPrayerGroupId: null,
      whatsappPrayerGroupName: null,
      whatsappOneTimeNeedGroupId: null,
      whatsappOneTimeNeedGroupName: null,
      whatsappNewsletterGroupId: null,
      whatsappNewsletterGroupName: null,
    },
  });
  await prisma.whatsAppAuthEntry.deleteMany({});
});

after(async () => {
  await whatsappClient.shutdown();
  if (originalSettings) {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: originalSettings });
  }
  await prisma.whatsAppAuthEntry.deleteMany({});
  await removeTestUsers();
  await stopServer();
});

describe("WhatsApp settings routes -- gating", () => {
  test("unauthenticated is rejected", async () => {
    assert.equal((await unauthenticated("/api/settings/whatsapp")).status, 401);
  });

  test("with the feature off, even an admin gets a 404 on every WhatsApp route", async () => {
    await setWhatsAppFeature(false);
    for (const [method, path] of [
      ["GET", "/api/settings/whatsapp"],
      ["PUT", "/api/settings/whatsapp"],
      ["POST", "/api/settings/whatsapp/pair"],
      ["GET", "/api/settings/whatsapp/pair/status"],
      ["GET", "/api/settings/whatsapp/communities"],
      ["GET", "/api/settings/whatsapp/communities/100@g.us/groups"],
      ["POST", "/api/settings/whatsapp/unlink"],
    ]) {
      const res = await admin(path, { method, body: method === "GET" ? undefined : {} });
      assert.equal(res.status, 404, `${method} ${path}`);
    }
  });

  test("with the feature on, an editor is still rejected -- admin only", async () => {
    await setWhatsAppFeature(true);
    assert.equal((await editor("/api/settings/whatsapp")).status, 403);
    assert.equal((await editor("/api/settings/whatsapp/pair", { method: "POST", body: {} })).status, 403);
  });

  test("the feature is off by default and listed in the registry", async () => {
    const { FEATURES } = require("../../src/utils/features");
    assert.equal(FEATURES.whatsapp.defaultEnabled, false);
  });
});

describe("WhatsApp settings routes -- picks", () => {
  before(() => setWhatsAppFeature(true));

  test("unpaired and unconfigured to start", async () => {
    const res = await admin("/api/settings/whatsapp");
    assert.equal(res.status, 200);
    assert.equal(res.body.paired, false);
    assert.equal(res.body.communityId, null);
    assert.equal(res.body.prayerGroupId, null);
  });

  test("a made-up group id is rejected rather than saved", async () => {
    const res = await admin("/api/settings/whatsapp", {
      method: "PUT",
      body: { prayerGroupId: "not a jid" },
    });
    assert.equal(res.status, 400);
  });

  test("saves a community and group picks; changing the community clears the old picks", async () => {
    let res = await admin("/api/settings/whatsapp", {
      method: "PUT",
      body: {
        communityId: "100@g.us",
        communityName: "Our Church Community",
        prayerGroupId: "111@g.us",
        prayerGroupName: "Prayer",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.communityName, "Our Church Community");
    assert.equal(res.body.prayerGroupId, "111@g.us");

    // Same community again -> picks survive.
    res = await admin("/api/settings/whatsapp", {
      method: "PUT",
      body: { communityId: "100@g.us", communityName: "Our Church Community" },
    });
    assert.equal(res.body.prayerGroupId, "111@g.us");

    // A different community -> the old community's groups no longer apply.
    res = await admin("/api/settings/whatsapp", {
      method: "PUT",
      body: { communityId: "999@g.us", communityName: "Other" },
    });
    assert.equal(res.body.communityId, "999@g.us");
    assert.equal(res.body.prayerGroupId, null);
    assert.equal(res.body.prayerGroupName, null);
  });
});

describe("WhatsApp pairing flow (fake socket)", () => {
  before(() => setWhatsAppFeature(true));

  test("phone-number pairing returns a code, then links on connection", async () => {
    const start = await admin("/api/settings/whatsapp/pair", {
      method: "POST",
      body: { phoneNumber: "+1 (555) 123-4567" },
    });
    assert.equal(start.status, 200);
    assert.equal(sockets.length, 1);

    sockets[0].ev.emit("connection.update", { qr: "RAW-QR" });
    const status = await until(async () => {
      const res = await admin("/api/settings/whatsapp/pair/status");
      return res.body.pairingCode ? res : null;
    });
    assert.equal(status.body.pairingCode, "ABCD1234");
    assert.equal(status.body.status, "pairing");
    assert.equal(status.headers.get("cache-control"), "no-store");

    // Real Baileys emits creds.update as pairing completes; the fake
    // must do the same for the session to be saved.
    sockets[0].ev.emit("creds.update", {});
    sockets[0].ev.emit("connection.update", { connection: "open" });
    await until(async () => (await admin("/api/settings/whatsapp")).body.paired);

    const settings = await admin("/api/settings/whatsapp");
    assert.equal(settings.body.phoneNumber, "15551234567");
    assert.equal(settings.body.connection.status, "connected");
    assert.deepEqual(settings.body.connection.health, { risk: "low", recommendation: "All good" });
  });

  test("a second pairing is refused while a number is linked", async () => {
    const res = await admin("/api/settings/whatsapp/pair", { method: "POST", body: {} });
    assert.equal(res.status, 409);
  });

  test("the number is never in the general settings payload any role can read", async () => {
    const res = await editor("/api/settings");
    assert.equal(res.status, 200);
    assert.ok(!("whatsappPhoneNumber" in res.body));
    assert.ok(!JSON.stringify(res.body).includes("15551234567"));
  });

  test("lists communities and a community's groups from the live socket", async () => {
    const communities = await admin("/api/settings/whatsapp/communities");
    assert.deepEqual(communities.body, [{ id: "100@g.us", name: "Our Church Community" }]);
    const groups = await admin("/api/settings/whatsapp/communities/100@g.us/groups");
    assert.deepEqual(
      groups.body.map((g) => g.name),
      ["Prayer", "One-time Needs", "Newsletters"]
    );
  });

  test("sendText goes out through the (wrapped) socket", async () => {
    await whatsappClient.sendText("111@g.us", "hello");
    assert.deepEqual(sockets[0].sent, [{ jid: "111@g.us", content: { text: "hello" } }]);
  });

  test("the stored session is encrypted at rest and never returned by any route", async () => {
    const rows = await prisma.whatsAppAuthEntry.findMany();
    assert.ok(rows.length > 0, "creds should have been saved");
    assert.ok(rows.some((row) => row.key === "creds"));
    for (const row of rows) assert.match(row.value, /^v1:/);
    for (const path of ["/api/settings/whatsapp", "/api/settings/whatsapp/pair/status", "/api/settings"]) {
      const text = JSON.stringify((await admin(path)).body);
      assert.ok(!text.includes("noiseKey") && !text.includes("v1:"), path);
    }
  });

  test("unlink logs the device out, wipes the session, and clears every pick", async () => {
    const res = await admin("/api/settings/whatsapp/unlink", { method: "POST", body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.paired, false);
    assert.equal(res.body.phoneNumber, null);
    assert.equal(res.body.communityId, null);
    assert.equal(sockets[0].loggedOut, true);
    assert.equal(await prisma.whatsAppAuthEntry.count(), 0);
  });

  test("QR pairing (no phone number) produces a QR image", async () => {
    const before = sockets.length;
    const start = await admin("/api/settings/whatsapp/pair", { method: "POST", body: {} });
    assert.equal(start.status, 200);
    sockets[before].ev.emit("connection.update", { qr: "RAW-QR" });
    const status = await until(async () => {
      const res = await admin("/api/settings/whatsapp/pair/status");
      return res.body.qrDataUrl ? res : null;
    });
    assert.match(status.body.qrDataUrl, /^data:image\/png;base64,/);
    assert.equal(status.body.pairingCode, null);
  });

  test("a bad phone number is rejected before any socket is opened", async () => {
    const before = sockets.length;
    const res = await admin("/api/settings/whatsapp/pair", { method: "POST", body: { phoneNumber: "12" } });
    assert.equal(res.status, 400);
    assert.equal(sockets.length, before);
  });
});

describe("keeping the socket in step with the settings", () => {
  test("settings say paired but the session is gone (restored backup): no socket, paired state cleared", async () => {
    await whatsappClient.shutdown();
    await prisma.whatsAppAuthEntry.deleteMany({});
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { whatsappPairedAt: new Date(), whatsappPhoneNumber: "15551234567" },
    });
    const before = sockets.length;
    whatsappClient._runtime.wantConnected = true;
    whatsappClient._runtime.unregisteredStreak = 0;
    // A single unregistered read is treated as a possible deploy-restart
    // race, not proof the session is gone -- it takes
    // UNREGISTERED_WIPE_THRESHOLD (3) consecutive reads in a row before
    // anything is wiped. Drive that many attempts directly rather than
    // waiting out the real reconnect timer between them.
    for (let i = 0; i < 3; i++) {
      clearTimeout(whatsappClient._runtime.reconnectTimer);
      whatsappClient._runtime.reconnectTimer = null;
      whatsappClient._runtime.rawSock = null;
      whatsappClient._runtime.connecting = false;
      await whatsappClient._connect();
    }
    assert.equal(sockets.length, before, "must not open a socket that can only emit unscanned QR codes");
    const after = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    assert.equal(after.whatsappPairedAt, null);
    assert.equal(whatsappClient.getStatus().status, "logged_out");
  });

  test("a single unregistered read right after startup does not wipe a real session", async () => {
    await whatsappClient.shutdown();
    await prisma.whatsAppAuthEntry.deleteMany({});
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { whatsappPairedAt: new Date(), whatsappPhoneNumber: "15551234567" },
    });
    whatsappClient._runtime.wantConnected = true;
    whatsappClient._runtime.unregisteredStreak = 0;
    clearTimeout(whatsappClient._runtime.reconnectTimer);
    whatsappClient._runtime.reconnectTimer = null;
    whatsappClient._runtime.rawSock = null;
    whatsappClient._runtime.connecting = false;
    await whatsappClient._connect();
    assert.equal(whatsappClient.getStatus().status, "connecting");
    const after = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    assert.ok(after.whatsappPairedAt, "one bad read must not wipe the paired state");
    // Clean up fully rather than leaving the paired-but-disconnected state
    // this test needed behind for later tests, which expect to start
    // unpaired.
    clearTimeout(whatsappClient._runtime.reconnectTimer);
    whatsappClient._runtime.reconnectTimer = null;
    whatsappClient._runtime.wantConnected = false;
    whatsappClient._runtime.unregisteredStreak = 0;
    await whatsappClient.shutdown();
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { whatsappPairedAt: null, whatsappPhoneNumber: null },
    });
  });

  test("turning the feature off closes a connected socket", async () => {
    // Re-establish a genuinely paired, connected session via the real flow.
    await setWhatsAppFeature(true);
    await admin("/api/settings/whatsapp/pair", { method: "POST", body: { phoneNumber: "15551234567" } });
    const sock = sockets.at(-1);
    sock.ev.emit("creds.update", {});
    sock.ev.emit("connection.update", { connection: "open" });
    await until(async () => (await admin("/api/settings/whatsapp")).body.paired);
    assert.equal(whatsappClient.getStatus().status, "connected");

    const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    await whatsappClient.syncWithSettings(settings, false);
    assert.equal(sock.ended, true);
    assert.equal(whatsappClient.getStatus().status, "disconnected");
    // The session itself is kept -- turning a feature off isn't unlinking.
    assert.ok((await prisma.whatsAppAuthEntry.count()) > 0);
  });
});
