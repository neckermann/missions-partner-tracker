// An upgrade runs on a database that already holds a church's data, but CI only ever migrates an empty one, where
// the usual ways a migration fails (a required column with no default, a rule that existing rows break, a unique
// index over rows that already match) cannot happen. This file covers both halves of that gap:
//
//  1. A populated database survives what an upgrade does on it today: `prisma migrate deploy` again changes
//     nothing, the start-up schema check agrees, the rows are untouched and the app still reads them.
//  2. A harness for the first real migration after 1.0 (SPEC.md 8.3): copies of populated tables in a scratch
//     schema, onto which a migration's SQL is applied. The tests below prove the harness catches each of those
//     failure modes. To check a real migration, add its SQL file to MIGRATIONS_TO_REHEARSE.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const prisma = require("../../src/prismaClient");
const { checkSchema } = require("../../src/utils/schemaCheck");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

const BACKEND = path.join(__dirname, "..", "..");
// After 1.0, name each new migration's folder here (for example "20270105120000_add_thing") and the harness applies
// its SQL to populated copies of every table it touches. Empty while there is only the baseline.
const MIGRATIONS_TO_REHEARSE = [];

let admin;
let partnerId;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();
  // A small but realistic household: a partner with an adult, a child, a prayer request and a one-time need.
  const partner = await prisma.partner.create({
    data: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} Upgrade household`,
      isPublic: true,
      adults: { create: [{ firstName: "Una", lastName: "Upgrade", email: "una@example.test" }] },
      children: { create: [{ firstName: "Uri", lastName: "Upgrade" }] },
    },
  });
  partnerId = partner.id;
  await prisma.prayerRequest.create({
    data: {
      partnerId,
      category: "situational",
      requestText: "Before the upgrade",
      dateReceived: new Date("2026-03-01"),
    },
  });
  // A second partner of the same kind, so a unique index on `kind` has duplicates to trip over.
  await prisma.partner.create({ data: { kind: "missionary", displayName: `${FIXTURE_TAG} Upgrade second` } });
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

const counts = async () => ({
  partners: await prisma.partner.count(),
  adults: await prisma.adult.count(),
  prayerRequests: await prisma.prayerRequest.count(),
  users: await prisma.user.count(),
});

describe("a populated database through an upgrade", () => {
  test("`prisma migrate deploy` again applies nothing and leaves every row alone", async () => {
    const before = {
      counts: await counts(),
      partner: await prisma.partner.findUnique({ where: { id: partnerId } }),
    };
    const out = execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: BACKEND,
      env: process.env,
      encoding: "utf8",
    });
    assert.match(out, /No pending migrations to apply/);
    assert.deepEqual(await counts(), before.counts);
    assert.deepEqual(await prisma.partner.findUnique({ where: { id: partnerId } }), before.partner);
  });

  test("the start-up schema check agrees with the populated database", async () => {
    assert.deepEqual(await checkSchema(prisma), []);
  });

  test("the app still reads the household, with its adult, child and request", async () => {
    const res = await admin(`/api/partners/${partnerId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.displayName, `${FIXTURE_TAG} Upgrade household`);
    // Adults and children are read through their own endpoints, not the partner record.
    const adults = await admin(`/api/adults?partnerId=${partnerId}`);
    assert.equal(adults.status, 200);
    assert.equal(adults.body.length, 1);
    assert.equal(adults.body[0].email, "una@example.test");
    const children = await admin(`/api/children?partnerId=${partnerId}`);
    assert.equal(children.body.length, 1);
    const requests = await admin(`/api/prayer-requests?partnerId=${partnerId}`);
    assert.equal(requests.status, 200);
    assert.ok(requests.body.some((r) => r.requestText === "Before the upgrade"));
  });
});

// --- The harness ---------------------------------------------------------------------------------------------

// Runs `fn(runSql)` against populated copies of `tables` in a scratch schema, then drops the schema. The copies
// keep their columns, defaults and constraints (LIKE ... INCLUDING ALL) and hold every row of the real tables, so a
// migration's SQL meets real data without touching the real tables. `runSql(sql)` runs one statement with the
// scratch schema first on the search path, so a migration written against "Partner" hits the copy.
async function withPopulatedCopies(tables, fn) {
  const scratch = `upgrade_scratch_${process.pid}`;
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA ${scratch}`);
  try {
    for (const table of tables) {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`
      );
      await prisma.$executeRawUnsafe(`INSERT INTO ${scratch}."${table}" SELECT * FROM public."${table}"`);
    }
    const runSql = (sql) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${scratch}`);
        await tx.$executeRawUnsafe(sql);
      });
    return await fn(runSql, scratch);
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`);
  }
}

// The Postgres error code of a rejected statement ("23502" a required column, "23514" a rule rows break, "23505"
// duplicate rows under a unique index).
const codeOf = async (promise) => {
  try {
    await promise;
    return null;
  } catch (err) {
    return err.meta?.driverAdapterError?.cause?.originalCode || err.meta?.code || err.code || "error";
  }
};

describe("the populated-copy harness", () => {
  test("the copies really hold populated rows (so a migration cannot pass by meeting an empty table)", async () => {
    await withPopulatedCopies(["Partner"], async (_run, scratch) => {
      const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${scratch}."Partner"`);
      assert.ok(n >= 2, `expected populated rows, found ${n}`);
    });
  });

  test("a safe migration (a column with a default, a rule the rows already meet) applies and keeps every row", async () => {
    await withPopulatedCopies(["Partner"], async (run, scratch) => {
      await run('ALTER TABLE "Partner" ADD COLUMN "upgradeNote" TEXT NOT NULL DEFAULT \'\'');
      await run(
        'ALTER TABLE "Partner" ADD CONSTRAINT upgrade_name_not_empty CHECK (length("displayName") > 0)'
      );
      const [{ n }] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM ${scratch}."Partner" WHERE "upgradeNote" = ''`
      );
      const [{ total }] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total FROM ${scratch}."Partner"`
      );
      assert.equal(n, total, "every existing row got the default");
    });
  });

  test("a required column with no default is caught: it fails on populated rows", async () => {
    await withPopulatedCopies(["Partner"], async (run) => {
      assert.equal(
        await codeOf(run('ALTER TABLE "Partner" ADD COLUMN "upgradeRequired" TEXT NOT NULL')),
        "23502"
      );
    });
  });

  test("a rule the existing rows break is caught", async () => {
    await withPopulatedCopies(["Partner"], async (run) => {
      assert.equal(
        await codeOf(run('ALTER TABLE "Partner" ADD CONSTRAINT upgrade_never CHECK ("kind" = \'nothing\')')),
        "23514"
      );
    });
  });

  test("a unique index over rows that already match is caught", async () => {
    await withPopulatedCopies(["Partner"], async (run) => {
      assert.equal(await codeOf(run('CREATE UNIQUE INDEX upgrade_one_kind ON "Partner" ("kind")')), "23505");
    });
  });

  test("the real tables were never touched by any of that", async () => {
    const cols = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Partner' AND column_name LIKE 'upgrade%'`
    );
    assert.deepEqual(cols, []);
  });

  // Each real migration after 1.0, applied to populated copies of the tables it names.
  for (const folder of MIGRATIONS_TO_REHEARSE) {
    test(`migration ${folder} applies to populated copies of the tables it touches`, async () => {
      const sql = fs.readFileSync(
        path.join(BACKEND, "prisma", "migrations", folder, "migration.sql"),
        "utf8"
      );
      const tables = [
        ...new Set(
          [...sql.matchAll(/(?:ALTER TABLE|CREATE (?:UNIQUE )?INDEX [^;]*? ON)\s+"?(\w+)"?/g)].map(
            (m) => m[1]
          )
        ),
      ];
      await withPopulatedCopies(tables, async (run) => {
        await run(sql);
      });
    });
  }
});
