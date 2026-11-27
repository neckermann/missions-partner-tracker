// The address the site is set to is handed to admins only (the banner that warns about a wrong address reads it).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let editor;
let savedBase;

before(async () => {
  savedBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://church.example.org/";
  await ensureTestUsers();
  [admin, editor] = await Promise.all([client("admin"), client("editor")]);
});

after(async () => {
  if (savedBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = savedBase;
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/auth/me and the site address", () => {
  test("an admin is told the address the site is set to", async () => {
    const res = await admin("/api/auth/me");
    assert.equal(res.body.user.configuredSiteOrigin, "https://church.example.org");
  });

  test("an editor is not", async () => {
    const res = await editor("/api/auth/me");
    assert.equal(res.body.user.configuredSiteOrigin, null);
  });
});
