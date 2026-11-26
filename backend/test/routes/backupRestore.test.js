const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const zlib = require("zlib");
const crypto = require("crypto");
const prisma = require("../../src/prismaClient");
const { buildBackup, parseBackup, latestMigrationName } = require("../../src/utils/backup");
const { encryptBackup, decryptBackup } = require("../../src/utils/backupCrypto");
const { beginRestore, endRestore } = require("../../src/utils/restoreLock");
const { clearAuditEnabledCache } = require("../../src/utils/auditLog");
const {
  client,
  startServer,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  TEST_USERS,
  TEST_PASSWORD,
  FIXTURE_TAG,
} = require("./helpers");

// Restoring from inside the app REPLACES everything, so every guard has a test against the real database:
// who may do it, the password and typed word, the file's own checks, the passphrase, the safety copy, one
// restore at a time, writes refused while it runs, all-or-nothing, and the audit entry.
let base;
let adminCookie;
let admin; // JSON client, for ordinary calls
let originalFeatures;

async function login(role) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_USERS[role].email, password: TEST_PASSWORD }),
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

// Raw multipart call (the safety copy comes back as bytes, which the JSON helper would mangle).
async function restore({
  file,
  password = TEST_PASSWORD,
  confirmation = "RESTORE",
  cookie = adminCookie,
  ...rest
}) {
  const form = new FormData();
  if (file) form.append("file", new Blob([file]), "backup.ndjson.gz");
  if (password !== undefined) form.append("password", password);
  if (confirmation !== undefined) form.append("confirmation", confirmation);
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) form.append(k, v);
  const res = await fetch(`${base}/api/backups/restore`, {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
    body: form,
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  let json = null;
  if ((res.headers.get("content-type") || "").includes("json")) {
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      // not JSON
    }
  }
  return { status: res.status, headers: res.headers, bytes, json };
}

const partnerNames = async () =>
  (
    await prisma.partner.findMany({
      where: { displayName: { contains: FIXTURE_TAG } },
      select: { displayName: true },
    })
  )
    .map((p) => p.displayName)
    .sort();

const makePartner = (name) =>
  prisma.partner.create({ data: { kind: "missionary", displayName: `${FIXTURE_TAG} ${name}` } });

// A backup file rebuilt from edited NDJSON text, with the checksum recomputed so only the edit under test differs.
function rebuild(
  text,
  { mutateBody = (lines) => lines, mutateManifest = (m) => m, recomputeChecksum = true } = {}
) {
  const [manifestLine, ...bodyLines] = text.split("\n").filter(Boolean);
  const lines = mutateBody(bodyLines);
  const manifest = mutateManifest(JSON.parse(manifestLine));
  if (recomputeChecksum)
    manifest.checksum = crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
  return zlib.gzipSync(Buffer.from([JSON.stringify(manifest), ...lines].join("\n"), "utf8"));
}

before(async () => {
  await ensureTestUsers();
  base = await startServer();
  admin = await client("admin");
  adminCookie = await login("admin");
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures ?? {};
  // The audit log on, so the restore's audit entry can be checked (the restored settings carry this too).
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures: { ...originalFeatures, auditTrail: true } },
    create: { id: "singleton", enabledFeatures: { auditTrail: true } },
  });
  clearAuditEnabledCache();
  await removeFixturePartners();
});

after(async () => {
  endRestore();
  await removeFixturePartners();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  clearAuditEnabledCache();
  await removeTestUsers();
  await stopServer();
});

describe("who may restore", () => {
  test("only an admin: editor and viewer are refused, and a signed-out caller is unauthorised", async () => {
    const file = (await buildBackup(prisma)).buffer;
    assert.equal((await restore({ file, cookie: await login("editor") })).status, 403);
    assert.equal((await restore({ file, cookie: await login("viewer") })).status, 403);
    assert.equal((await restore({ file, cookie: "" })).status, 401);
  });
});

describe("what the admin must give", () => {
  test("a file, the exact word RESTORE and their password, each checked before anything happens", async () => {
    const file = (await buildBackup(prisma)).buffer;
    assert.equal((await restore({ file: null })).status, 400, "no file");
    assert.equal(
      (await restore({ file, confirmation: "restore" })).status,
      400,
      "the word must match exactly"
    );
    assert.equal((await restore({ file, confirmation: "" })).status, 400, "no confirmation");
    assert.equal((await restore({ file, password: "" })).status, 400, "no password");
    const wrong = await restore({ file, password: "not-my-password" });
    assert.equal(wrong.status, 401);
    assert.match(wrong.json.error, /isn't right/);
  });

  test("a wrong password changes nothing", async () => {
    const keep = await makePartner("kept after refusal");
    const file = (await buildBackup(prisma)).buffer;
    await prisma.partner.delete({ where: { id: keep.id } });
    assert.equal((await restore({ file, password: "wrong" })).status, 401);
    assert.deepEqual(await partnerNames(), [], "the backup was not applied");
  });
});

describe("what is wrong with the file", () => {
  test("not a backup at all", async () => {
    const res = await restore({ file: Buffer.from("this is not a backup") });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /doesn't look like a backup/);
  });

  test("a backup whose contents were edited (checksum mismatch)", async () => {
    await makePartner("edited");
    const text = zlib.gunzipSync((await buildBackup(prisma)).buffer).toString("utf8");
    const tampered = rebuild(text, {
      recomputeChecksum: false,
      mutateBody: (lines) => lines.map((l) => l.replace(`${FIXTURE_TAG} edited`, `${FIXTURE_TAG} EDITED`)),
    });
    const res = await restore({ file: tampered });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Checksum mismatch/);
    assert.deepEqual(await partnerNames(), [`${FIXTURE_TAG} edited`], "nothing changed");
    await removeFixturePartners();
  });

  test("a backup made for a different version of the database", async () => {
    const text = zlib.gunzipSync((await buildBackup(prisma)).buffer).toString("utf8");
    const old = rebuild(text, { mutateManifest: (m) => ({ ...m, migrationName: "20200101000000_old" }) });
    const res = await restore({ file: old });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /different version/);
    assert.ok(res.json.error.includes(latestMigrationName()));
  });

  test("a file over the size limit is turned away with a pointer to the command", async () => {
    const res = await restore({ file: Buffer.alloc(41 * 1024 * 1024, 1) });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /too large to restore from the browser/);
  });
});

describe("a backup locked with a passphrase", () => {
  test("needs the passphrase; a wrong one is refused; the right one restores", async () => {
    await makePartner("in the locked backup");
    const locked = encryptBackup((await buildBackup(prisma)).buffer, "correct horse battery");
    await removeFixturePartners();

    const none = await restore({ file: locked });
    assert.equal(none.status, 400);
    assert.match(none.json.error, /locked with a passphrase/);
    const wrong = await restore({ file: locked, passphrase: "not the passphrase" });
    assert.equal(wrong.status, 400);
    assert.match(wrong.json.error, /Wrong passphrase/);
    assert.deepEqual(await partnerNames(), [], "refusals changed nothing");

    const ok = await restore({ file: locked, passphrase: "correct horse battery" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await partnerNames(), [`${FIXTURE_TAG} in the locked backup`]);
    await removeFixturePartners();
  });
});

describe("a successful restore", () => {
  test("replaces what is there with the backup, hands back a safety copy of what was there, and is audited", async () => {
    await makePartner("in the backup");
    const backupFile = (await buildBackup(prisma)).buffer;
    await makePartner("made after the backup");
    assert.equal((await partnerNames()).length, 2);

    const res = await restore({ file: backupFile });
    assert.equal(res.status, 200, res.json && JSON.stringify(res.json));

    // The data is the backup's: the later partner is gone.
    assert.deepEqual(await partnerNames(), [`${FIXTURE_TAG} in the backup`]);

    // The response is a safety copy of the data as it was just before: it is a valid backup, and it holds both.
    assert.match(
      res.headers.get("content-disposition"),
      /^attachment; filename="before-restore-.*\.ndjson\.gz"$/
    );
    assert.ok(Number(res.headers.get("x-restored-rows")) > 0);
    const safety = parseBackup(zlib.gunzipSync(res.bytes).toString("utf8"));
    const safetyNames = safety.rowsByModel.partner
      .map((p) => p.displayName)
      .filter((n) => n.includes(FIXTURE_TAG))
      .sort();
    assert.deepEqual(safetyNames, [`${FIXTURE_TAG} in the backup`, `${FIXTURE_TAG} made after the backup`]);

    // The restore is on the record.
    const entry = await prisma.auditLog.findFirst({
      where: { action: "backup.restored" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(entry, "an audit entry for the restore");
    assert.equal(entry.actorEmail, TEST_USERS.admin.email);

    // The safety copy really undoes it: restoring it brings the later partner back.
    const undo = await restore({ file: res.bytes });
    assert.equal(undo.status, 200);
    assert.deepEqual(await partnerNames(), [
      `${FIXTURE_TAG} in the backup`,
      `${FIXTURE_TAG} made after the backup`,
    ]);
    await removeFixturePartners();
  });

  test("the safety copy can be locked with its own passphrase", async () => {
    const backupFile = (await buildBackup(prisma)).buffer;
    const res = await restore({ file: backupFile, safetyPassphrase: "a safety passphrase" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /\.ndjson\.gz\.locked"$/);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    const opened = decryptBackup(res.bytes, "a safety passphrase");
    assert.ok(parseBackup(zlib.gunzipSync(opened).toString("utf8")).manifest);
    const tooShort = await restore({ file: backupFile, safetyPassphrase: "short" });
    assert.equal(tooShort.status, 400);
  });

  test("the admin who restored is still signed in (their account is in the backup)", async () => {
    const backupFile = (await buildBackup(prisma)).buffer;
    assert.equal((await restore({ file: backupFile })).status, 200);
    assert.equal((await admin("/api/auth/me")).status, 200);
  });
});

describe("all or nothing", () => {
  test("a backup that fails partway leaves every existing row exactly as it was", async () => {
    const present = await makePartner("must survive a failed restore");
    const text = zlib.gunzipSync((await buildBackup(prisma)).buffer).toString("utf8");
    // A well-formed file (valid checksum) with one row pointing at a partner that does not exist: the insert
    // fails near the END of the restore, after every existing row has been deleted inside the transaction.
    const poisoned = rebuild(text, {
      mutateBody: (lines) => [
        ...lines,
        JSON.stringify({
          model: "adult",
          row: {
            id: crypto.randomUUID(),
            partnerId: "no-such-partner",
            firstName: "Orphan",
            lastName: "Row",
          },
        }),
      ],
    });
    const before = await prisma.partner.count();
    const res = await restore({ file: poisoned });
    assert.ok(res.status >= 400, `the restore failed (${res.status})`);
    assert.equal(await prisma.partner.count(), before, "no partner was lost");
    assert.ok(
      await prisma.partner.findUnique({ where: { id: present.id } }),
      "the existing partner is still there"
    );
    assert.equal(
      await prisma.user.count({ where: { email: TEST_USERS.admin.email } }),
      1,
      "and so are the users"
    );
    // The lock is released: the site takes writes again.
    const write = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} after failure` },
    });
    assert.equal(write.status, 201);
    await removeFixturePartners();
  });
});

describe("one at a time, and no other writes while it runs", () => {
  test("a second restore is refused while one holds the lock", async () => {
    assert.equal(beginRestore(), true);
    try {
      const res = await restore({ file: (await buildBackup(prisma)).buffer });
      assert.equal(res.status, 409);
      assert.match(res.json.error, /already running/);
    } finally {
      endRestore();
    }
  });

  test("every other write is answered 503 while it runs, reads still work, and writes resume after", async () => {
    assert.equal(beginRestore(), true);
    try {
      const write = await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} blocked` },
      });
      assert.equal(write.status, 503);
      assert.equal(write.headers.get("retry-after"), "60");
      assert.match(write.body.error, /being restored/);
      assert.equal((await admin("/api/partners")).status, 200, "reads are fine");
    } finally {
      endRestore();
    }
    const after = await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} allowed again` },
    });
    assert.equal(after.status, 201);
    await removeFixturePartners();
  });
});
