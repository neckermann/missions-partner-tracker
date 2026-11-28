const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const zlib = require("zlib");
const prisma = require("../../src/prismaClient");
const { buildBackup, parseBackup, restoreRows, BYTES_FIELDS } = require("../../src/utils/backup");
const fs = require("fs");
const path = require("path");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  FIXTURE_TAG,
  TEST_PASSWORD,
} = require("./helpers");

let admin;
let editor;
let viewer;
let unauthenticated;
let originalEnabledFeatures;

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, unauthenticated] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(),
  ]);

  // The TripMeeting round-trip fixture needs POST /api/trips and POST /api/trips/:id/meetings
  // reachable, but `trips` defaults to off (routes/tripMeetings.js's requireFeature("trips"))
  // and CI's e2e job only enables it after the whole route-test suite (see ci.yml), so this
  // can't rely on ambient state. Save/restore like trips.test.js's setFeatures: restore whatever
  // existed at the start, not unconditionally off.
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
});

after(async () => {
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await removeTestUsers();
  await stopServer();
});

describe("POST /api/backups/download", () => {
  const post = (who, body) => who("/api/backups/download", { method: "POST", body });

  test("admin with the right password gets a gzip attachment", async () => {
    const res = await post(admin, { password: TEST_PASSWORD });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/gzip");
    assert.match(res.headers.get("content-disposition"), /^attachment; filename="backup-.*\.ndjson\.gz"$/);
  });

  test("a wrong or missing password is refused", async () => {
    const wrong = await post(admin, { password: "not-the-password" });
    assert.equal(wrong.status, 401);
    assert.equal((await post(admin, {})).status, 400);
    assert.equal((await post(admin, { password: "" })).status, 400);
  });

  test("the old GET link no longer downloads anything", async () => {
    const res = await admin("/api/backups/download");
    assert.ok([404, 405].includes(res.status), `GET gave ${res.status}`);
  });

  test("with a passphrase the file is locked: a different type and name, and not a gzip", async () => {
    const res = await post(admin, { password: TEST_PASSWORD, passphrase: "correct horse battery" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.match(res.headers.get("content-disposition"), /\.ndjson\.gz\.locked"$/);
    assert.ok(String(res.body).startsWith("MPTBAK2"), "it is the streamed locked format, not plain gzip");
  });

  test("a passphrase that is too short is refused", async () => {
    const res = await post(admin, { password: TEST_PASSWORD, passphrase: "short" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least 8/);
  });

  test("editor and viewer are refused -- this is a site-wide admin action, not per-record data", async () => {
    assert.equal((await post(editor, { password: TEST_PASSWORD })).status, 403);
    assert.equal((await post(viewer, { password: TEST_PASSWORD })).status, 403);
  });

  test("unauthenticated is refused", async () => {
    assert.equal((await post(unauthenticated, { password: TEST_PASSWORD })).status, 401);
  });
});

describe("backup/restore round trip", () => {
  test("a passphrase-locked backup unlocks to exactly the same checksummed file", async () => {
    const { encryptBackup, decryptBackup } = require("../../src/utils/backupCrypto");
    const { buffer, manifest } = await buildBackup(prisma);
    const locked = encryptBackup(buffer, "correct horse battery");
    const parsed = parseBackup(
      zlib.gunzipSync(decryptBackup(locked, "correct horse battery")).toString("utf8")
    );
    assert.equal(parsed.manifest.checksum, manifest.checksum);
    assert.throws(() => decryptBackup(locked, "wrong passphrase!"), /Wrong passphrase/);
  });

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
  test("a partner file's bytes round-trip exactly through export encoding and restore decoding", async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Backup Bytes Fixture` },
    });
    const originalBytes = Buffer.from("not actually a PDF, just test bytes \x00\x01\xff", "latin1");
    const file = await prisma.partnerFile.create({
      data: {
        partnerId: partner.body.id,
        kind: "other",
        customKind: "Background Check",
        receivedDate: new Date("2026-01-01"),
        fileName: "fixture.bin",
        contentType: "application/octet-stream",
        bytesRow: { create: { bytes: originalBytes } },
      },
    });

    const { buffer } = await buildBackup(prisma);
    const text = zlib.gunzipSync(buffer).toString("utf8");
    const { rowsByModel } = parseBackup(text);
    // The bytes live in their own table, with the same shared id as the parent partnerFile row.
    const exportedRow = rowsByModel.partnerFileBytes.find((r) => r.id === file.id);
    assert.ok(exportedRow, "the fixture file's bytes row should appear in the backup");
    assert.ok(Buffer.isBuffer(exportedRow.bytes), "decoded bytes should be a real Buffer");
    assert.ok(originalBytes.equals(exportedRow.bytes), "bytes should round-trip exactly");

    await prisma.partnerFile.delete({ where: { id: file.id } });
    await prisma.partner.delete({ where: { id: partner.body.id } });
  });

  // Reads prisma/schema.prisma as text, independently of the code under test, so the
  // list of binary columns can't drift the way a hand-kept one did (surveyUpload.bytes
  // was left out and every restore failed on that table).
  test("every Bytes column in the schema is encoded for backup", () => {
    const schema = fs.readFileSync(path.join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
    const expected = {};
    for (const block of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      const [, name, body] = block;
      if (name === "WhatsAppAuthEntry" || name === "SpentPasskeyChallenge") continue; // excluded from backups on purpose
      for (const line of body.split("\n")) {
        const m = line.trim().match(/^(\w+)\s+Bytes\??(\s|$)/);
        if (m) (expected[name.charAt(0).toLowerCase() + name.slice(1)] ||= []).push(m[1]);
      }
    }
    assert.ok(Object.keys(expected).length >= 7, "should have found the schema's Bytes columns");
    assert.deepEqual(
      Object.fromEntries(Object.entries(BYTES_FIELDS).map(([k, v]) => [k, [...v].sort()])),
      Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, [...v].sort()]))
    );
  });

  // The bug found by the review: a survey photo waiting for approval made the backup
  // unrestorable, because its bytes were not base64-encoded.
  test("a survey photo waiting for approval survives a full backup/restore round trip", async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Survey Upload Fixture` },
    });
    const survey = await prisma.survey.create({ data: { title: `${FIXTURE_TAG} Survey`, status: "open" } });
    const response = await prisma.surveyResponse.create({
      data: { surveyId: survey.id, partnerId: partner.body.id },
    });
    const originalBytes = Buffer.from("not really a photo \x00\x01\xff", "latin1");
    const upload = await prisma.surveyUpload.create({
      data: {
        responseId: response.id,
        partnerId: partner.body.id,
        contentType: "image/jpeg",
        fileSize: originalBytes.length,
        bytes: originalBytes,
      },
    });

    try {
      const { buffer } = await buildBackup(prisma);
      const { rowsByModel } = parseBackup(zlib.gunzipSync(buffer).toString("utf8"));
      const exported = rowsByModel.surveyUpload.find((r) => r.id === upload.id);
      assert.ok(exported, "the waiting photo should appear in the backup");
      assert.ok(Buffer.isBuffer(exported.bytes), "decoded bytes should be a real Buffer");
      assert.ok(originalBytes.equals(exported.bytes), "bytes should round-trip exactly");

      // Remove the chain, then restore just it from the backup's own rows.
      await prisma.surveyUpload.delete({ where: { id: upload.id } });
      await prisma.surveyResponse.delete({ where: { id: response.id } });
      await prisma.survey.delete({ where: { id: survey.id } });
      await prisma.partner.delete({ where: { id: partner.body.id } });
      await restoreRows(prisma, {
        partner: rowsByModel.partner.filter((r) => r.id === partner.body.id),
        survey: rowsByModel.survey.filter((r) => r.id === survey.id),
        surveyResponse: rowsByModel.surveyResponse.filter((r) => r.id === response.id),
        surveyUpload: [exported],
      });
      const restored = await prisma.surveyUpload.findUnique({ where: { id: upload.id } });
      assert.ok(restored, "the waiting photo should exist again");
      assert.ok(
        originalBytes.equals(Buffer.from(restored.bytes)),
        "restored bytes should match the original"
      );
    } finally {
      await prisma.surveyUpload.deleteMany({ where: { id: upload.id } });
      await prisma.surveyResponse.deleteMany({ where: { id: response.id } });
      await prisma.survey.deleteMany({ where: { id: survey.id } });
      await prisma.partner.deleteMany({ where: { id: partner.body.id } });
    }
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

  // The actual bug, not just MODELS containing the right strings: TripMeeting was one of the
  // models that fell off backup/restore entirely (buildBackup never queried it, and parseBackup
  // would have thrown "Unknown model in backup file"). This exercises the real round trip:
  // create it, back the database up through buildBackup/parseBackup (not a hand-built
  // rowsByModel), delete it, restore, and confirm it and its trip survive with their data
  // intact.
  test("a TripMeeting (one of the 25 models #271 Finding 8 found missing) survives a full backup/restore round trip", async () => {
    const partner = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} Trip Meeting Fixture` },
    });
    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: partner.body.id, status: "planning" },
    });
    const meeting = await admin(`/api/trips/${trip.body.id}/meetings`, {
      method: "POST",
      body: {
        startAt: "2027-01-15T18:00:00.000Z",
        title: `${FIXTURE_TAG} Prep Meeting`,
        agenda: "Packing list review",
      },
    });
    assert.equal(meeting.status, 201);

    const { buffer } = await buildBackup(prisma);
    const text = zlib.gunzipSync(buffer).toString("utf8");
    const { rowsByModel } = parseBackup(text);
    assert.ok(rowsByModel.tripMeeting, "tripMeeting should be a known model in the backup file");
    const backedUpMeeting = rowsByModel.tripMeeting.find((r) => r.id === meeting.body.id);
    assert.ok(backedUpMeeting, "the fixture meeting should appear in the backup");

    await prisma.tripMeeting.delete({ where: { id: meeting.body.id } });
    assert.equal(await prisma.tripMeeting.findUnique({ where: { id: meeting.body.id } }), null);

    const counts = await restoreRows(prisma, { tripMeeting: [backedUpMeeting] });
    assert.equal(counts.tripMeeting, 1);

    const restored = await prisma.tripMeeting.findUnique({ where: { id: meeting.body.id } });
    assert.ok(restored, "the deleted meeting should exist again after restore");
    assert.equal(restored.title, `${FIXTURE_TAG} Prep Meeting`);
    assert.equal(restored.agenda, "Packing list review");
    assert.equal(restored.tripId, trip.body.id);

    await prisma.trip.delete({ where: { id: trip.body.id } });
    await prisma.partner.delete({ where: { id: partner.body.id } });
  });
});
