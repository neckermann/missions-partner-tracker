// The start-up schema check against the real test database, which `prisma migrate deploy` built from the
// migrations in this code, and against copies of those migrations that have been rewritten since.
const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const fs = require("fs");
const os = require("os");
const path = require("path");
const prisma = require("../../src/prismaClient");
const { checkSchema, DEFAULT_MIGRATIONS_DIR } = require("../../src/utils/schemaCheck");

after(async () => {
  await prisma.$disconnect();
});

function copyOfMigrations(edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
  for (const entry of fs.readdirSync(DEFAULT_MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    fs.mkdirSync(path.join(dir, entry.name));
    fs.copyFileSync(
      path.join(DEFAULT_MIGRATIONS_DIR, entry.name, "migration.sql"),
      path.join(dir, entry.name, "migration.sql")
    );
  }
  edit?.(dir);
  return dir;
}

describe("checkSchema against the real database", () => {
  test("a database built from this code's migrations has no problems", async () => {
    assert.deepEqual(await checkSchema(prisma), []);
  });

  test("the same database against a migration that was edited afterwards is reported as rewritten", async () => {
    const dir = copyOfMigrations((d) => {
      const [first] = fs.readdirSync(d);
      fs.appendFileSync(
        path.join(d, first, "migration.sql"),
        '\nALTER TABLE "User" ADD COLUMN "later" TEXT;\n'
      );
    });
    const problems = await checkSchema(prisma, dir);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].kind, "rewritten");
  });

  test("a migration the database never applied is reported as missing", async () => {
    const dir = copyOfMigrations((d) => {
      fs.mkdirSync(path.join(d, "29990101000000_next"));
      fs.writeFileSync(path.join(d, "29990101000000_next", "migration.sql"), "SELECT 1;");
    });
    const problems = await checkSchema(prisma, dir);
    assert.deepEqual(
      problems.map((p) => p.kind),
      ["missing"]
    );
  });
});
