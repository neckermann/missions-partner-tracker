const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  removeFixturePartners,
  ensureTestUsers,
  removeTestUsers,
  FIXTURE_TAG,
} = require("./helpers");

describe("GET /api/photos/:id/raw -- content-type allowlist", () => {
  let unauthenticated;
  let partnerId;

  before(async () => {
    unauthenticated = await client();
    const partner = await prisma.partner.create({
      data: { kind: "missionary", isPublic: true, displayName: `${FIXTURE_TAG} Photos content-type test` },
    });
    partnerId = partner.id;
  });

  after(async () => {
    await removeFixturePartners();
    await stopServer();
  });

  test("a verified image type is served as itself", async () => {
    const photo = await prisma.photo.create({
      data: {
        partnerId,
        bytesRow: { create: { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } }, // PNG signature, not a full valid file -- irrelevant here
        receivedDate: new Date("2026-01-01"),
        contentType: "image/png",
      },
    });

    const res = await unauthenticated(`/api/photos/${photo.id}/raw`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
  });

  test("a webp photo is served as itself, not downgraded to octet-stream", async () => {
    // Regression test: VERIFIED_INLINE_TYPES didn't include image/webp even though partners.js
    // accepts and signature-verifies webp uploads, so every webp partner/org photo rendered as a
    // broken image.
    const photo = await prisma.photo.create({
      data: {
        partnerId,
        bytesRow: { create: { bytes: Buffer.from("RIFF\0\0\0\0WEBP") } }, // WebP signature, not a full valid file -- irrelevant here
        receivedDate: new Date("2026-01-01"),
        contentType: "image/webp",
      },
    });

    const res = await unauthenticated(`/api/photos/${photo.id}/raw`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
  });

  test("an unverified contentType never reaches the response header", async () => {
    // Not reachable through the normal upload path (multer + fileFilter in
    // partners.js only ever write image/jpeg, image/png, or image/webp) --
    // this is a direct DB write standing in for any future path that could
    // insert a Photo row some other way (a migration, an admin tool, a
    // bug). The allowlist in routes/photos.js is what makes this safe
    // regardless of how a bad contentType got there.
    const photo = await prisma.photo.create({
      data: {
        partnerId,
        bytesRow: { create: { bytes: Buffer.from("<script>alert(1)</script>") } },
        receivedDate: new Date("2026-01-01"),
        contentType: "text/html",
      },
    });

    const res = await unauthenticated(`/api/photos/${photo.id}/raw`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
  });

  test("Cross-Origin-Resource-Policy allows cross-origin embedding", async () => {
    // Regression test: helmet()'s global default (Cross-Origin-Resource-Policy: same-origin)
    // blocked a webmail client from embedding this image inline in a digest email, since that is a
    // cross-origin <img> embed, not a same-origin request.
    const photo = await prisma.photo.create({
      data: {
        partnerId,
        bytesRow: { create: { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } },
        receivedDate: new Date("2026-01-01"),
        contentType: "image/png",
      },
    });

    const res = await unauthenticated(`/api/photos/${photo.id}/raw`);
    assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
  });
});

// A photo is open to anyone only while its partner is on the public site and not restricted; otherwise the
// address alone no longer works and a signed-in session is needed.
describe("GET /api/photos/:id/raw -- who may fetch it", () => {
  let unauthenticated;
  let staff;
  const ids = {};

  async function makePhoto(label, partnerData) {
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: `${FIXTURE_TAG} Photo access ${label}`, ...partnerData },
    });
    const photo = await prisma.photo.create({
      data: {
        partnerId: partner.id,
        bytesRow: { create: { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } },
        receivedDate: new Date("2026-01-01"),
        contentType: "image/png",
      },
    });
    return photo.id;
  }

  before(async () => {
    await ensureTestUsers();
    unauthenticated = await client();
    staff = await client("editor");
    ids.public = await makePhoto("public", { isPublic: true });
    ids.hidden = await makePhoto("hidden", { isPublic: false });
    ids.restricted = await makePhoto("restricted", { isPublic: true, isRestricted: true });
  });

  after(async () => {
    await removeFixturePartners();
    await removeTestUsers();
    await stopServer();
  });

  test("a public partner's photo is open to anyone, and cacheable by shared caches", async () => {
    const res = await unauthenticated(`/api/photos/${ids.public}/raw`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control"), /^public/);
  });

  test("a partner who is not public: refused without a sign-in, served to staff", async () => {
    assert.equal((await unauthenticated(`/api/photos/${ids.hidden}/raw`)).status, 401);
    const res = await staff(`/api/photos/${ids.hidden}/raw`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.match(res.headers.get("cache-control"), /^private/, "never kept by a shared cache");
  });

  test("a restricted partner's real photo needs a sign-in even though the partner is public", async () => {
    assert.equal((await unauthenticated(`/api/photos/${ids.restricted}/raw`)).status, 401);
    assert.equal((await staff(`/api/photos/${ids.restricted}/raw`)).status, 200);
  });

  test("an unknown photo is a plain 404 for anyone", async () => {
    assert.equal((await unauthenticated("/api/photos/does-not-exist/raw")).status, 404);
  });
});
