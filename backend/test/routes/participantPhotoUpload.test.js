// A participant's photo is sent as a base64 data URL in the update body. Staff could not upload a real one: the
// body was capped at 100 KB for every route but a few public ones, so anything over about 75 KB of photo was refused
// with "request entity too large". Also: the photo limit is 15 MB (the browser shrinks a photo before sending, so
// this is the safety net) and only a signed-in person gets the larger body.
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

// A real 1x1 PNG followed by padding: the server checks the file's signature, not that every pixel decodes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const photoOf = (bytes) =>
  `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(bytes)]).toString("base64")}`;

let admin;
let anon;
let participant;
let originalEnabledFeatures;

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  const enabledFeatures = { ...originalEnabledFeatures, trips: true };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
  const partner = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} photo upload` },
    })
  ).body;
  const trip = (
    await admin("/api/trips", { method: "POST", body: { partnerId: partner.id, type: "Construction" } })
  ).body;
  participant = (
    await admin(`/api/trips/${trip.id}/participants`, {
      method: "POST",
      body: { firstName: "Pat", lastName: "Probe" },
    })
  ).body;
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("a staff-uploaded participant photo", () => {
  const put = (who, bytes, extra = {}) =>
    who(`/api/trips/participants/${participant.id}`, {
      method: "PUT",
      body: { photo: photoOf(bytes), photoContentType: "image/png", ...extra },
    });

  test("a photo of a normal size is accepted and stored", async () => {
    const res = await put(admin, 1024 * 1024);
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    const row = await prisma.tripParticipantPhoto.findUnique({ where: { id: participant.id } });
    assert.ok(row && row.photo.length > 1024 * 1024, "the whole photo was stored");
  });

  test("a real large photo gets a small copy for pages, and the full one stays at /photo/raw", async () => {
    const sharp = require("sharp");
    const raw = Buffer.alloc(2400 * 1600 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + (i >> 5) * 17) & 255;
    const full = await sharp(raw, { raw: { width: 2400, height: 1600, channels: 3 } })
      .jpeg()
      .toBuffer();
    const res = await admin(`/api/trips/participants/${participant.id}`, {
      method: "PUT",
      body: { photo: `data:image/jpeg;base64,${full.toString("base64")}`, photoContentType: "image/jpeg" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    const row = await prisma.tripParticipantPhoto.findUnique({ where: { id: participant.id } });
    assert.equal(row.photo.length, full.length);
    assert.ok(row.displayBytes && row.displayBytes.length < full.length / 4);

    const base = `/api/public/trips/participants/${participant.id}/photo`;
    const shown = await anon(base);
    assert.equal(shown.headers.get("content-type"), "image/jpeg");
    assert.equal(Number(shown.headers.get("content-length")), row.displayBytes.length);
    const rawRes = await anon(`${base}/raw`);
    assert.equal(Number(rawRes.headers.get("content-length")), full.length);
  });

  test("a photo near the 15 MB limit is accepted", async () => {
    const res = await put(admin, 14 * 1024 * 1024);
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
  });

  test("a photo over 15 MB is refused with a plain message", async () => {
    const res = await put(admin, 16 * 1024 * 1024);
    assert.ok([400, 413].includes(res.status), `status ${res.status}`);
    assert.doesNotMatch(
      String(res.body?.error || ""),
      /^request entity too large$/,
      "not the parser's bare message when the body is under its cap"
    );
  });

  test("only a signed-in person gets the larger body: an anonymous caller is refused", async () => {
    const res = await put(anon, 1024 * 1024);
    assert.equal(res.status, 401);
  });

  test("other routes keep the small body cap", async () => {
    const res = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: "x".repeat(200 * 1024) },
    });
    assert.equal(res.status, 413);
  });
});
