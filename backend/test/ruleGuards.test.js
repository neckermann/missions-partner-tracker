const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Guards for rules that CLAUDE.md and CONTRIBUTING.md state in words. Each reads the source so a change that
// breaks the rule fails here, not in a review a year later. (The "no window.confirm()/alert()/prompt()" rule is the
// `no-alert` lint rule in eslint.config.js; the documentation-links rule is `npm run check:docs`.)
const ROOT = path.join(__dirname, "..", "..");

function filesUnder(dir, exts, { skip = /node_modules|[\\/]dist[\\/]|[\\/]public[\\/]/ } = {}) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip.test(full)) continue;
    if (entry.isDirectory()) out.push(...filesUnder(full, exts, { skip }));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f);
const isTest = (f) => /\.test\.|[\\/]e2e[\\/]|[\\/]test[\\/]/.test(f);
const frontendSource = filesUnder(path.join(ROOT, "frontend", "src"), [".js", ".jsx"]).filter(
  (f) => !isTest(f)
);
const backendSource = filesUnder(path.join(ROOT, "backend", "src"), [".js"]);

function offenders(files, pattern) {
  const found = [];
  for (const file of files) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) found.push(`${rel(file)}:${i + 1}`);
      });
  }
  return found;
}

describe("single origin (CONTRIBUTING.md: don't add cross-origin support)", () => {
  test("the source files were found", () => {
    assert.ok(frontendSource.length > 100, `only ${frontendSource.length} frontend files found`);
    assert.ok(backendSource.length > 50, `only ${backendSource.length} backend files found`);
  });

  test("the frontend holds no API address override and no hand-built own address", () => {
    assert.deepEqual(offenders(frontendSource, /import\.meta\.env\.VITE_[A-Z_]*(URL|API|ORIGIN|HOST)/), []);
    assert.deepEqual(
      offenders(frontendSource, /https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.onrender\.com)/i),
      []
    );
    const client = fs.readFileSync(path.join(ROOT, "frontend", "src", "api", "client.js"), "utf8");
    assert.match(client, /baseURL:\s*"\/api"/, "every request goes to a relative /api address");
  });

  test("the backend has no cross-origin (CORS) support", () => {
    assert.deepEqual(offenders(backendSource, /require\(["']cors["']\)|Access-Control-Allow-Origin/), []);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "backend", "package.json"), "utf8"));
    assert.equal(pkg.dependencies?.cors, undefined);
  });
});

describe("migrations come from `prisma migrate` (CLAUDE.md: never hand-written)", () => {
  const dir = path.join(ROOT, "backend", "prisma", "migrations");
  const folders = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  test("there is at least one migration, in Prisma's folder shape", () => {
    assert.ok(folders.length >= 1);
    for (const name of folders) {
      assert.match(name, /^\d{14}_[a-z0-9_]+$/, `${name}: not <timestamp>_<name>`);
      assert.ok(fs.existsSync(path.join(dir, name, "migration.sql")), `${name}: no migration.sql`);
    }
    assert.match(
      fs.readFileSync(path.join(dir, "migration_lock.toml"), "utf8"),
      /provider\s*=\s*"postgresql"/
    );
  });

  test("each migration opens with the comment markers Prisma writes", () => {
    // Prisma starts every statement group with "-- CreateTable", "-- AlterTable" and so on. A migration written
    // by hand almost never does. (The baseline has a hand-added tail of constraints, by design: SPEC.md 8.3.)
    for (const name of folders) {
      const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8").trimStart();
      assert.match(
        sql,
        /^-- (CreateSchema|CreateEnum|CreateTable|AlterTable|AlterEnum|DropTable|DropEnum|CreateIndex|DropIndex|AddForeignKey|DropForeignKey|RedefineTables|RenameIndex)/,
        `${name}: does not start like a Prisma migration`
      );
    }
  });
});
