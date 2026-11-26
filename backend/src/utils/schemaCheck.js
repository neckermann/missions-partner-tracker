// Refuses to go live on a database that was not built from the migrations in this code.
//
// Before 1.0 every schema change is edited into the one baseline migration in place (SPEC.md § 8.3). A database
// that already applied the OLD text of that migration sees the migration as done, so `prisma migrate deploy`
// does nothing and reports success; the new code then runs against the old tables, and the site is "live"
// but broken (a missing column on the first request). Prisma records a SHA-256 of each migration file when it
// applies it, so a migration that was rewritten afterwards shows up as a different checksum. Checked at
// start-up, before the server listens: the deploy then fails its health check and Render leaves the previous
// version serving, instead of replacing a working site with a broken one.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, "..", "..", "prisma", "migrations");

// The migrations in this code: [{ name, checksum }], in order. Prisma's checksum is the SHA-256 (hex) of the file.
function readMigrations(dir = DEFAULT_MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "migration.sql")))
    .map((e) => ({
      name: e.name,
      checksum: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(dir, e.name, "migration.sql")))
        .digest("hex"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Pure: what is wrong, given the migrations in the code and the rows Prisma recorded in the database.
// `rows` are { migration_name, checksum, finished_at, rolled_back_at }.
function findProblems(migrations, rows) {
  const problems = [];
  for (const m of migrations) {
    const applied = rows.filter((r) => r.migration_name === m.name && !r.rolled_back_at);
    if (applied.length === 0) {
      problems.push({
        kind: "missing",
        migration: m.name,
        message: `The database has not applied migration ${m.name}. Run "npx prisma migrate deploy" first.`,
      });
    } else if (!applied.some((r) => r.finished_at)) {
      problems.push({
        kind: "unfinished",
        migration: m.name,
        message: `Migration ${m.name} started but did not finish in this database.`,
      });
    } else if (!applied.some((r) => r.checksum === m.checksum)) {
      problems.push({
        kind: "rewritten",
        migration: m.name,
        message:
          `This database was built from an earlier version of migration ${m.name}, which this release ` +
          `has changed (before 1.0 the schema is edited into one migration in place). The tables do not match ` +
          `this code, so it will not start. A database made before this release must be reset and its data ` +
          `re-entered or restored from a backup: see UPGRADING.md.`,
      });
    }
  }
  return problems;
}

async function checkSchema(prisma, dir = DEFAULT_MIGRATIONS_DIR) {
  let rows;
  try {
    rows =
      await prisma.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  } catch {
    return [
      {
        kind: "no-table",
        migration: null,
        message: 'The database has no migration history. Run "npx prisma migrate deploy" first.',
      },
    ];
  }
  return findProblems(readMigrations(dir), rows);
}

// For server.js: throws a readable error instead of starting. SKIP_SCHEMA_CHECK=true is an emergency way past it
// (documented in RUNBOOK.md): only for someone who knows the database matches.
async function assertSchemaMatches(prisma, env = process.env, dir = DEFAULT_MIGRATIONS_DIR) {
  if (env.SKIP_SCHEMA_CHECK === "true") {
    console.warn("SKIP_SCHEMA_CHECK=true: not checking that the database matches this release's migrations.");
    return;
  }
  const problems = await checkSchema(prisma, dir);
  if (problems.length > 0) {
    const error = new Error(problems.map((p) => p.message).join("\n"));
    error.name = "SchemaMismatchError";
    error.problems = problems;
    throw error;
  }
}

module.exports = { readMigrations, findProblems, checkSchema, assertSchemaMatches, DEFAULT_MIGRATIONS_DIR };
