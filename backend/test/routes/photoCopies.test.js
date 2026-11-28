// A photo is shown from a smaller copy (GET /api/photos/:id) and kept in full (GET /api/photos/:id/raw); the
// logo is shrunk when it is uploaded. Same access rules for both copies.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const sharp = require("sharp");
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

async function jpeg(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + (i >> 5) * 17) & 255;
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg()
    .toBuffer();
}

let admin;
let editor;
let anon;
let big;
let originalFeatures;

before(async () => {
  // The public directory is off by default; one test reads the public partner page.
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = current?.enabledFeatures ?? {};
  const features = { ...originalFeatures, publicDirectory: true };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures: features },
    create: { id: "singleton", enabledFeatures: features },
  });
  await ensureTestUsers();
  [admin, editor, anon] = await Promise.all([client("admin"), client("editor"), client(null)]);
  await removeFixturePartners();
  big = await jpeg(3000, 2000);
});

after(async () => {
  await prisma.churchSettings.updateMany({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

const length = (res) => Number(res.headers.get("content-length"));

async function uploadFor(displayName, extra = {}) {
  const partner = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} ${displayName}` },
  });
  assert.equal(partner.status, 201);
  // Set directly: what matters here is who may fetch the photo, not how a partner is made public.
  if (Object.keys(extra).length) await prisma.partner.update({ where: { id: partner.body.id }, data: extra });
  const form = new FormData();
  form.set("image", new Blob([big], { type: "image/jpeg" }), "photo.jpg");
  const res = await editor(`/api/partners/${partner.body.id}/image`, { method: "POST", body: form });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
  return res.body;
}

describe("a partner photo upload", () => {
  test("keeps the full copy and makes a smaller one; the API gives both addresses", async () => {
    const partner = await uploadFor("copies", { isPublic: true });
    const photo = partner.photos[0];
    assert.equal(photo.url, `/api/photos/${photo.id}`);
    assert.equal(photo.rawUrl, `/api/photos/${photo.id}/raw`);

    const row = await prisma.photoBytes.findUnique({ where: { id: photo.id } });
    assert.equal(row.bytes.length, big.length, "the full copy is exactly what was uploaded");
    assert.ok(row.displayBytes && row.displayBytes.length < big.length / 4);
    const meta = await sharp(row.displayBytes).metadata();
    assert.equal(meta.width, 800);
    assert.equal(meta.height, 533);
  });

  test("the page address serves the small copy as a JPEG, /raw serves the full one", async () => {
    const partner = await uploadFor("served", { isPublic: true });
    const photo = partner.photos[0];
    const row = await prisma.photoBytes.findUnique({ where: { id: photo.id } });

    const shown = await anon(photo.url);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get("content-type"), "image/jpeg");
    assert.equal(length(shown), row.displayBytes.length);
    assert.match(shown.headers.get("cache-control"), /public.*immutable/);

    const full = await anon(photo.rawUrl);
    assert.equal(full.status, 200);
    assert.equal(length(full), big.length);
  });

  test("a photo with no small copy is shown from the full one at both addresses", async () => {
    const partner = await uploadFor("nocopy", { isPublic: true });
    const id = partner.photos[0].id;
    await prisma.photoBytes.update({ where: { id }, data: { displayBytes: null } });
    assert.equal(length(await anon(`/api/photos/${id}`)), big.length);
    assert.equal(length(await anon(`/api/photos/${id}/raw`)), big.length);
  });

  test("both addresses follow the same access rules", async () => {
    const hidden = (await uploadFor("hidden", { isPublic: false })).photos[0];
    const restricted = (await uploadFor("restricted", { isPublic: true, isRestricted: true })).photos[0];
    for (const photo of [hidden, restricted]) {
      for (const path of [photo.url, photo.rawUrl]) {
        assert.equal((await anon(path)).status, 401, `${path} refuses an anonymous caller`);
        assert.equal((await editor(path)).status, 200, `${path} opens for signed-in staff`);
      }
    }
    assert.equal((await anon("/api/photos/does-not-exist")).status, 404);
  });

  test("the public partner page links the small copy and the full one", async () => {
    const partner = await uploadFor("public page", { isPublic: true });
    const res = await anon(`/api/public/partners/${partner.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.photo, partner.photos[0].url);
    assert.equal(res.body.photoFull, partner.photos[0].rawUrl);
  });
});

describe("the church logo upload", () => {
  test("is shrunk to 800px wide and keeps its format", async () => {
    const wide = await sharp({
      create: { width: 2400, height: 600, channels: 4, background: { r: 10, g: 80, b: 160, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("image", new Blob([wide], { type: "image/png" }), "logo.png");
    const res = await admin("/api/settings/logo", { method: "POST", body: form });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    const row = await prisma.churchSettingsLogo.findUnique({ where: { id: "singleton" } });
    const meta = await sharp(row.logoBytes).metadata();
    assert.equal(meta.width, 800);
    assert.equal(meta.format, "png");
    assert.equal(meta.hasAlpha, true);
    const shown = await anon("/api/public/settings/logo/raw");
    assert.equal(shown.headers.get("content-type"), "image/png");
  });
});
