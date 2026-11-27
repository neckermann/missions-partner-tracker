// Backups are streamed (#575): never held in memory whole, read twice from one snapshot so the manifest can come
// first, verified before a restore writes anything, and still the same file format as before.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { Writable } = require("stream");
const prisma = require("../../src/prismaClient");
const {
  writeBackup,
  buildBackup,
  parseBackup,
  verifyBackupFile,
  restoreBackupFile,
  isLockedBackupFile,
} = require("../../src/utils/backup");
const { encryptBackup, decryptBackup, isEncryptedBackup } = require("../../src/utils/backupCrypto");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
  TEST_PASSWORD,
} = require("./helpers");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mpt-backup-"));
const file = (name) => path.join(dir, name);
let admin;
let partner;
let photo;
const photoBytes = crypto.randomBytes(64 * 1024);

// A backup written to a file on disk.
async function backupTo(name, opts) {
  const target = file(name);
  const out = fs.createWriteStream(target);
  const { manifest } = await writeBackup(prisma, out, opts);
  return { target, manifest };
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();
  partner = await prisma.partner.create({
    data: { kind: "organization", displayName: `${FIXTURE_TAG} stream` },
  });
  await prisma.adult.create({ data: { partnerId: partner.id, firstName: "Pat", phone1: "+13375550100" } });
  photo = await prisma.photo.create({
    data: {
      partnerId: partner.id,
      receivedDate: new Date(),
      contentType: "image/jpeg",
      fileSize: photoBytes.length,
    },
  });
  await prisma.photoBytes.create({ data: { id: photo.id, bytes: photoBytes } });
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  fs.rmSync(dir, { recursive: true, force: true });
  await stopServer();
});

describe("the streamed file is the same format", () => {
  test("parseBackup reads it, its checksum and row counts match, and it holds the fixture rows", async () => {
    const { buffer, manifest } = await buildBackup(prisma);
    const parsed = parseBackup(zlib.gunzipSync(buffer).toString("utf8"));
    assert.equal(parsed.manifest.checksum, manifest.checksum);
    assert.equal(manifest.rowCounts.partner, await prisma.partner.count());
    assert.equal(manifest.rowCounts.photoBytes, await prisma.photoBytes.count());
    const row = parsed.rowsByModel.photoBytes.find((r) => r.id === photo.id);
    assert.ok(Buffer.from(row.bytes).equals(photoBytes), "a photo's bytes survive the base64 round trip");
    assert.ok(parsed.rowsByModel.partner.some((p) => p.id === partner.id));
  });

  test("a file on disk verifies, and restores the fixture rows (photo bytes included) after they are deleted", async () => {
    const { target, manifest } = await backupTo("plain.ndjson.gz");
    assert.equal((await verifyBackupFile(target)).checksum, manifest.checksum);
    assert.equal(await isLockedBackupFile(target), false);

    await prisma.partner.delete({ where: { id: partner.id } }); // cascades to the adult and the photo
    assert.equal(await prisma.partner.count({ where: { id: partner.id } }), 0);

    const mine = (model, row) =>
      (model === "partner" && row.id === partner.id) ||
      ((model === "adult" || model === "photo") && row.partnerId === partner.id) ||
      (model === "photoBytes" && row.id === photo.id);
    const { counts } = await restoreBackupFile(prisma, target, { filter: mine });
    assert.deepEqual(
      [counts.partner, counts.adult, counts.photo, counts.photoBytes],
      [1, 1, 1, 1],
      "exactly the rows chosen were restored"
    );
    const back = await prisma.photoBytes.findUnique({ where: { id: photo.id } });
    assert.ok(Buffer.from(back.bytes).equals(photoBytes));
    assert.equal((await prisma.adult.findFirst({ where: { partnerId: partner.id } })).phone1, "+13375550100");
  });
});

describe("a bad file is refused before anything is written", () => {
  const countBefore = () => prisma.partner.count();

  async function tampered(name, edit) {
    const { target } = await backupTo(name);
    const text = zlib.gunzipSync(fs.readFileSync(target)).toString("utf8");
    fs.writeFileSync(target, zlib.gzipSync(edit(text)));
    return target;
  }

  test("an edited row (the checksum no longer matches)", async () => {
    const target = await tampered("edited.ndjson.gz", (t) =>
      t.replace(`${FIXTURE_TAG} stream`, `${FIXTURE_TAG} streem`)
    );
    const before = await countBefore();
    await assert.rejects(restoreBackupFile(prisma, target), /Checksum mismatch/);
    assert.equal(await countBefore(), before);
  });

  test("a manifest whose row counts don't match the file", async () => {
    const target = await tampered("counts.ndjson.gz", (t) => {
      const [first, ...rest] = t.split("\n");
      const m = JSON.parse(first);
      m.rowCounts.partner += 1;
      return [JSON.stringify(m), ...rest].join("\n");
    });
    await assert.rejects(verifyBackupFile(target), /doesn't match its manifest/);
  });

  test("a row of a model this version doesn't know", async () => {
    const target = await tampered(
      "unknown.ndjson.gz",
      (t) => t + "\n" + JSON.stringify({ model: "notAModel", row: {} })
    );
    await assert.rejects(verifyBackupFile(target), /Unknown model|Checksum mismatch/);
  });

  test("a file that is cut short", async () => {
    const { target } = await backupTo("cut.ndjson.gz");
    const whole = fs.readFileSync(target);
    fs.writeFileSync(target, whole.subarray(0, Math.floor(whole.length / 2)));
    const before = await countBefore();
    await assert.rejects(restoreBackupFile(prisma, target), /damaged or incomplete/);
    assert.equal(await countBefore(), before);
  });

  test("something that isn't a backup, and an empty file", async () => {
    fs.writeFileSync(file("junk.gz"), zlib.gzipSync("hello\nworld"));
    await assert.rejects(verifyBackupFile(file("junk.gz")));
    fs.writeFileSync(file("empty.gz"), zlib.gzipSync(""));
    await assert.rejects(verifyBackupFile(file("empty.gz")), /Empty backup file/);
  });
});

describe("a locked file", () => {
  const passphrase = "correct horse battery";

  test("a streamed locked file is the v2 layout, verifies with the passphrase, and opens in memory too", async () => {
    const { target, manifest } = await backupTo("locked.ndjson.gz.locked", { passphrase });
    const bytes = fs.readFileSync(target);
    assert.equal(bytes.subarray(0, 8).toString("utf8"), "MPTBAK2\n");
    assert.ok(isEncryptedBackup(bytes));
    assert.equal(await isLockedBackupFile(target), true);
    assert.equal((await verifyBackupFile(target, { passphrase })).checksum, manifest.checksum);
    const parsed = parseBackup(zlib.gunzipSync(decryptBackup(bytes, passphrase)).toString("utf8"));
    assert.equal(parsed.manifest.checksum, manifest.checksum);
  });

  test("a wrong passphrase, no passphrase, or a changed byte is refused", async () => {
    const { target } = await backupTo("locked2.ndjson.gz.locked", { passphrase });
    await assert.rejects(verifyBackupFile(target, { passphrase: "another passphrase!" }), /Wrong passphrase/);
    await assert.rejects(verifyBackupFile(target), /protected with a passphrase/);
    const bytes = fs.readFileSync(target);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(target, bytes);
    await assert.rejects(
      verifyBackupFile(target, { passphrase }),
      /Wrong passphrase, or the backup file was changed|incorrect|invalid|unexpected/i
    );
  });

  test("a file locked the older way (v1) still opens", async () => {
    const { buffer, manifest } = await buildBackup(prisma);
    const v1 = encryptBackup(buffer, passphrase);
    assert.equal(v1.subarray(0, 8).toString("utf8"), "MPTBAK1\n");
    fs.writeFileSync(file("old.locked"), v1);
    assert.equal(await isLockedBackupFile(file("old.locked")), true);
    assert.equal((await verifyBackupFile(file("old.locked"), { passphrase })).checksum, manifest.checksum);
  });
});

describe("one snapshot", () => {
  test("rows added between the two reads are not in the file, and the file still verifies", async () => {
    let intruder;
    const { target, manifest } = await backupTo("snapshot.ndjson.gz", {
      afterCount: async () => {
        // A different connection, after the counting pass and before the writing pass.
        intruder = await prisma.partner.create({
          data: { kind: "organization", displayName: `${FIXTURE_TAG} intruder` },
        });
      },
    });
    try {
      assert.ok(intruder, "the hook ran");
      assert.equal((await verifyBackupFile(target)).checksum, manifest.checksum);
      const text = zlib.gunzipSync(fs.readFileSync(target)).toString("utf8");
      assert.ok(!text.includes(intruder.id), "the row written between the passes is not in the file");
    } finally {
      await prisma.partner.delete({ where: { id: intruder.id } });
    }
  });
});

describe("memory stays flat", () => {
  test("backing up many photos holds a few batches at a time, not the whole of them", async () => {
    const photos = 60;
    const each = 512 * 1024;
    const made = [];
    for (let i = 0; i < photos; i++) {
      const p = await prisma.photo.create({
        data: { partnerId: partner.id, receivedDate: new Date(), contentType: "image/jpeg", fileSize: each },
      });
      await prisma.photoBytes.create({ data: { id: p.id, bytes: crypto.randomBytes(each) } });
      made.push(p.id);
    }
    try {
      let written = 0;
      const sink = new Writable({
        write(chunk, _enc, cb) {
          written += chunk.length;
          cb();
        },
      });
      if (global.gc) global.gc();
      const baseline = process.memoryUsage().rss;
      let peak = baseline;
      const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 10);
      await writeBackup(prisma, sink);
      clearInterval(sampler);
      peak = Math.max(peak, process.memoryUsage().rss);
      const mb = (n) => Math.round(n / 1048576);
      assert.ok(written > photos * each * 0.9, `the backup holds the photos (${mb(written)} MB written)`);
      // The photos alone are 30 MB. Held in memory the old way this grew by about 7 times that (over 200 MB);
      // streamed it should stay within a small multiple of one batch.
      assert.ok(
        mb(peak - baseline) < 90,
        `memory grew by ${mb(peak - baseline)} MB while backing up ${mb(photos * each)} MB of photos`
      );
    } finally {
      await prisma.photo.deleteMany({ where: { id: { in: made } } });
    }
  });
});

describe("the download route streams the same file", () => {
  test("an admin gets a gzip that verifies and restores, and the download is audited", async () => {
    const before = await prisma.auditLog.count({ where: { action: "backup.downloaded" } });
    const res = await admin("/api/backups/download", { method: "POST", body: { password: TEST_PASSWORD } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(res.headers.get("content-disposition").includes("backup-"));
    assert.equal(await prisma.auditLog.count({ where: { action: "backup.downloaded" } }), before + 1);
  });
});
