// H3: the backup download's rate limit counts per admin account, after the admin check. It used to run first and
// count per address, so five anonymous requests from one address (a shared office network, a scanner) locked the
// real admin out for 15 minutes.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
// routes/backups.js pulls in prismaClient.js, which reads DATABASE_URL when it is required.
require("dotenv").config({ quiet: true });
const express = require("express");
const { createBackupLimiter } = require("../src/routes/backups");

// A stand-in for requireRole("admin"): the caller is named by a header, and no header means no session (401),
// exactly the way an anonymous request never gets past the real check.
function appWithLimit(max) {
  const app = express();
  app.use((req, res, next) => {
    const id = req.get("x-admin");
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id, role: "admin" };
    return next();
  });
  app.use(createBackupLimiter(max));
  app.post("/download", (req, res) => res.json({ ok: true }));
  return app;
}

let server;
let base;
before(async () => {
  server = appWithLimit(3).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const post = (admin) =>
  fetch(`${base}/download`, { method: "POST", headers: admin ? { "x-admin": admin } : {} });

describe("the backup download limit", () => {
  test("anonymous requests from the same address do not use up an admin's allowance", async () => {
    for (let i = 0; i < 10; i += 1) assert.equal((await post(null)).status, 401);
    for (let i = 0; i < 3; i += 1)
      assert.equal((await post("admin-a")).status, 200, `admin request ${i + 1}`);
  });

  test("an admin is stopped after their own allowance, and the next admin is not", async () => {
    for (let i = 0; i < 3; i += 1) assert.equal((await post("admin-b")).status, 200);
    assert.equal((await post("admin-b")).status, 429, "the fourth is refused");
    assert.equal((await post("admin-c")).status, 200, "another admin, same address, is unaffected");
  });

  test("the real limit is five a quarter hour", async () => {
    // Only the shape is checked here: the default under production settings.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const prodApp = express();
      prodApp.use((req, res, next) => {
        req.user = { id: "prod-admin" };
        next();
      });
      prodApp.use(createBackupLimiter());
      prodApp.post("/download", (req, res) => res.json({ ok: true }));
      const s = prodApp.listen(0);
      await new Promise((r) => s.once("listening", r));
      try {
        const url = `http://127.0.0.1:${s.address().port}/download`;
        const statuses = [];
        for (let i = 0; i < 6; i += 1) statuses.push((await fetch(url, { method: "POST" })).status);
        assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
      } finally {
        await new Promise((r) => s.close(r));
      }
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
