const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { detectProvider } = require("../src/utils/backupCheck");

describe("detectProvider", () => {
  let original;
  beforeEach(() => {
    original = process.env.DATABASE_URL;
  });
  afterEach(() => {
    process.env.DATABASE_URL = original;
  });

  test("recognizes Neon", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@ep-floral-heart-ax0dnb7s.us-east-2.aws.neon.tech/neondb";
    assert.equal(detectProvider(), "neon");
  });

  test("recognizes Supabase", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@db.abcdefgh.supabase.co:5432/postgres";
    assert.equal(detectProvider(), "supabase");
  });

  test("recognizes RDS", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@mydb.abc123.us-east-2.rds.amazonaws.com:5432/app";
    assert.equal(detectProvider(), "rds");
  });

  test("falls back to 'other' for an unrecognized host", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@my-self-hosted-box.example.com:5432/app";
    assert.equal(detectProvider(), "other");
  });

  test("falls back to 'other' when unset", () => {
    delete process.env.DATABASE_URL;
    assert.equal(detectProvider(), "other");
  });
});
