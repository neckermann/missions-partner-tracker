const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let editor;
let viewer;
let unauthenticated;

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, unauthenticated] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(),
  ]);
});

after(async () => {
  await removeTestUsers();
  await stopServer();
});

describe("GET /api/system-info", () => {
  test("admin gets real version/runtime/database/deployment info", async () => {
    const res = await admin("/api/system-info");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.app.version, "string");
    assert.equal(typeof res.body.app.updateAvailable, "boolean");
    assert.ok(res.body.runtime.node.startsWith("v"), res.body.runtime.node);
    assert.ok(res.body.database.version.toLowerCase().includes("postgresql"), res.body.database.version);
    assert.equal(typeof res.body.database.sizeBytes, "number");
    assert.ok(res.body.database.sizeBytes > 0);
    // express/prisma/@prisma/client are real devDependencies/dependencies
    // of this very project, so these should always resolve in any
    // environment this test suite runs in.
    assert.equal(typeof res.body.dependencies.express, "string");
    assert.equal(typeof res.body.dependencies.prisma, "string");
    assert.equal(typeof res.body.dependencies.prismaClient, "string");
    // deployment.onRender is whatever this test's own environment says --
    // just confirm the shape is internally consistent either way.
    if (res.body.deployment.onRender) {
      assert.equal(typeof res.body.deployment.serviceName, "string");
    } else {
      assert.equal(res.body.deployment.serviceName, null);
      assert.equal(res.body.deployment.gitCommit, null);
      assert.equal(res.body.deployment.externalUrl, null);
    }
  });

  test("never leaks the database connection string or any credential", async () => {
    const res = await admin("/api/system-info");
    const serialized = JSON.stringify(res.body);
    assert.ok(
      !serialized.includes(process.env.DATABASE_URL),
      "DATABASE_URL must never appear in the response"
    );
    assert.ok(!/postgres(ql)?:\/\//i.test(serialized), "no connection-string-shaped value should appear");
  });

  test("editor and viewer are refused -- this is deployment-management info, not per-record data", async () => {
    assert.equal((await editor("/api/system-info")).status, 403);
    assert.equal((await viewer("/api/system-info")).status, 403);
  });

  test("unauthenticated is refused", async () => {
    assert.equal((await unauthenticated("/api/system-info")).status, 401);
  });
});
