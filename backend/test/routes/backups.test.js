const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const zlib = require("zlib");
const prisma = require("../../src/prismaClient");
const { buildBackup, parseBackup, restoreRows } = require("../../src/utils/backup");
const { client, stopServer, ensureTestUsers, removeTestUsers, FIXTURE_TAG } = require("./helpers");

let admin;
let editor;
let viewer;
let unauthenticated;

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, unauthenticated] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(),
  ]);
});

after(async () => {
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/backups/download", () => {
  test("admin gets a gzip attachment", async () => {
    const res = await admin("/api/backups/download");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/gzip");
    assert.match(res.headers.get("content-disposition"), /^attachment; filename="backup-.*\.ndjson\.gz"$/);
  });

  test("editor and viewer are refused -- this is a site-wide admin action, not per-record data", async () => {
    assert.equal((await editor("/api/backups/download")).status, 403);
    assert.equal((await viewer("/api/backups/download")).status, 403);
  });

  test("unauthenticated is refused", async () => {
    assert.equal((await unauthenticated("/api/backups/download")).status, 401);
  });
});

describe("backup/restore round trip", () => {
  test("buildBackup's checksum is exactly what parseBackup verifies, with matching row counts", async () => {
    const { buffer, manifest } = await buildBackup(prisma);
    const text = zlib.gunzipSync(buffer).toString("utf8");
    const parsed = parseBackup(text);
    assert.equal(parsed.manifest.checksum, manifest.checksum);
    assert.deepEqual(parsed.manifest.rowCounts, manifest.rowCounts);
  });

  test("parseBackup rejects a file whose content doesn't match its recorded checksum", async () => {
    const { buffer } = await buildBackup(prisma);
    const text = zlib.gunzipSync(buffer).toString("utf8");
    const tampered = text.replace("\n", "\ntampered-line-that-was-never-checksummed\n");
    assert.throws(() => parseBackup(tampered), /Checksum mismatch/);
  });

  // Regression test for a real bug caught while building this: Prisma 7's
  // driver-adapter client returns a plain Uint8Array for a Bytes column,
  // not a Node Buffer. Buffer.isBuffer() on one of those is false, which
  // silently skipped base64 encoding and let the raw byte array through to
  // JSON.stringify -- producing a bulky, undecodable {"0":70,"1":114,...}
  // object instead of a string, which then failed Prisma's own Bytes
  // validation on restore.
  test("a document's bytes round-trip exactly through export encoding and restore decoding", async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Backup Bytes Fixture` },
    });
    const originalBytes = Buffer.from("not actually a PDF, just test bytes \x00\x01\xff", "latin1");
    const doc = await prisma.document.create({
      data: {
        partnerId: partner.body.id,
        category: "other",
        receivedDate: new Date("2026-01-01"),
        fileName: "fixture.bin",
        contentType: "application/octet-stream",
        bytes: originalBytes,
      },
    });

    const { buffer } = await buildBackup(prisma);
    const text = zlib.gunzipSync(buffer).toString("utf8");
    const { rowsByModel } = parseBackup(text);
    const exportedRow = rowsByModel.document.find((r) => r.id === doc.id);
    assert.ok(exportedRow, "the fixture document should appear in the backup");
    assert.ok(Buffer.isBuffer(exportedRow.bytes), "decoded bytes should be a real Buffer");
    assert.ok(originalBytes.equals(exportedRow.bytes), "bytes should round-trip exactly");

    await prisma.document.delete({ where: { id: doc.id } });
    await prisma.partner.delete({ where: { id: partner.body.id } });
  });

  test("restoreRows recreates a deleted partner from its backed-up row", async () => {
    const created = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Restore Fixture` },
    });
    const rawRow = await prisma.partner.findUniqueOrThrow({ where: { id: created.body.id } });
    await prisma.partner.delete({ where: { id: created.body.id } });

    const counts = await restoreRows(prisma, { partner: [rawRow] });
    assert.equal(counts.partner, 1);

    const restored = await prisma.partner.findUnique({ where: { id: created.body.id } });
    assert.ok(restored, "the deleted partner should exist again");
    assert.equal(restored.displayName, rawRow.displayName);

    await prisma.partner.delete({ where: { id: created.body.id } });
  });
});
