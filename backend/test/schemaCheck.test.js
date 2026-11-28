// The start-up check that refuses to go live on a database built from an older version of the (rewritten
// in place, before 1.0) baseline migration. This covers the decision itself and the failure message; the
// real database is in test/routes/schemaCheck.test.js.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readMigrations, findProblems, assertSchemaMatches } = require("../src/utils/schemaCheck");

const migrations = [{ name: "20260101000000_init", checksum: "aaa" }];
const applied = (over = {}) => ({
  migration_name: "20260101000000_init",
  checksum: "aaa",
  finished_at: new Date(),
  rolled_back_at: null,
  ...over,
});

describe("findProblems", () => {
  test("nothing is wrong when every migration is applied with the checksum in this code", () => {
    assert.deepEqual(findProblems(migrations, [applied()]), []);
  });

  test("a migration that was rewritten after the database applied it is reported, and says what to do", () => {
    const problems = findProblems(migrations, [applied({ checksum: "an-older-version" })]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].kind, "rewritten");
    assert.match(problems[0].message, /earlier version of migration 20260101000000_init/);
    assert.match(problems[0].message, /UPGRADING\.md/);
  });

  test("a migration the database has not applied is reported", () => {
    assert.equal(findProblems(migrations, [])[0].kind, "missing");
  });

  test("a rolled-back or unfinished migration does not count as applied", () => {
    assert.equal(findProblems(migrations, [applied({ rolled_back_at: new Date() })])[0].kind, "missing");
    assert.equal(findProblems(migrations, [applied({ finished_at: null })])[0].kind, "unfinished");
  });

  test("a migration applied again after a rollback counts", () => {
    const rows = [applied({ rolled_back_at: new Date() }), applied()];
    assert.deepEqual(findProblems(migrations, rows), []);
  });
});

describe("readMigrations", () => {
  test("hashes each migration.sql the way Prisma records it (SHA-256, hex), in order", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
    for (const [name, sql] of [
      ["20260202000000_second", "SELECT 2;"],
      ["20260101000000_first", "SELECT 1;"],
    ]) {
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, "migration.sql"), sql);
    }
    fs.writeFileSync(path.join(dir, "migration_lock.toml"), "provider = 'postgresql'");
    const found = readMigrations(dir);
    assert.deepEqual(
      found.map((m) => m.name),
      ["20260101000000_first", "20260202000000_second"]
    );
    assert.equal(found[0].checksum, require("crypto").createHash("sha256").update("SELECT 1;").digest("hex"));
  });
});

describe("assertSchemaMatches", () => {
  const fakePrisma = (rows) => ({ $queryRaw: async () => rows });
  const dirWith = (sql) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
    fs.mkdirSync(path.join(dir, "20260101000000_init"));
    fs.writeFileSync(path.join(dir, "20260101000000_init", "migration.sql"), sql);
    return dir;
  };
  const sum = (s) => require("crypto").createHash("sha256").update(s).digest("hex");

  test("passes when the database matches", async () => {
    const dir = dirWith("SELECT 1;");
    await assertSchemaMatches(fakePrisma([applied({ checksum: sum("SELECT 1;") })]), {}, dir);
  });

  test("throws a readable SchemaMismatchError when it does not", async () => {
    const dir = dirWith("SELECT 1; -- new column");
    await assert.rejects(
      () => assertSchemaMatches(fakePrisma([applied({ checksum: sum("SELECT 1;") })]), {}, dir),
      (err) => err.name === "SchemaMismatchError" && /earlier version/.test(err.message)
    );
  });

  test("a database with no migration history is told to run migrate deploy", async () => {
    const prisma = {
      $queryRaw: async () => {
        throw new Error('relation "_prisma_migrations" does not exist');
      },
    };
    await assert.rejects(() => assertSchemaMatches(prisma, {}, dirWith("SELECT 1;")), /migrate deploy/);
  });

  test("SKIP_SCHEMA_CHECK=true is the way past it, and says so", async () => {
    await assertSchemaMatches(fakePrisma([]), { SKIP_SCHEMA_CHECK: "true" }, dirWith("SELECT 1;"));
  });
});
