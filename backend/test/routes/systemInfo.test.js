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
    // deployment.onRender is whatever this test's own environment says, so only one of these two shapes
    // is ever seen in a given run; both are covered below by setting the variables the route reads.
    assert.equal(typeof res.body.deployment.onRender, "boolean");
  });

  test("on Render the deployment names its service, and off Render those fields are null", async () => {
    const keys = ["RENDER_SERVICE_NAME", "RENDER_GIT_COMMIT", "RENDER_EXTERNAL_URL"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      const off = (await admin("/api/system-info")).body.deployment;
      assert.equal(off.onRender, false);
      assert.equal(off.serviceName, null);
      assert.equal(off.gitCommit, null);
      assert.equal(off.externalUrl, null);

      process.env.RENDER_SERVICE_NAME = "church-app";
      process.env.RENDER_GIT_COMMIT = "abc1234";
      process.env.RENDER_EXTERNAL_URL = "https://church-app.onrender.com";
      const on = (await admin("/api/system-info")).body.deployment;
      assert.equal(on.onRender, true);
      assert.equal(on.serviceName, "church-app");
      assert.equal(on.gitCommit, "abc1234");
      assert.equal(on.externalUrl, "https://church-app.onrender.com");
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
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
