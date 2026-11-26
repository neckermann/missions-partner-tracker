const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// The seed fills a database with fake people. It must never give any of them a password that is
// written in the repo: anyone could read it and sign in to a seeded copy left running.
const seedSource = fs.readFileSync(path.join(__dirname, "..", "prisma", "seed.js"), "utf8");

test("the seed hashes no literal password", () => {
  const literal = seedSource.match(/bcrypt\.hash\(\s*["'`]/g);
  assert.equal(
    literal,
    null,
    "bcrypt.hash must be given a generated or configured value, never a string literal"
  );
});

test("the old shared seed password is gone", () => {
  assert.ok(!seedSource.includes("SeedDemoUser2026"));
});

test("the seed creates the settings row it later updates, for a fresh empty database", () => {
  assert.ok(seedSource.includes('churchSettings.upsert({ where: { id: "singleton" }'));
});
