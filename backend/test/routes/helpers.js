// Boots the real Express app on an ephemeral port and talks to it over
// real HTTP. No mocking and no new dependency -- src/server.js exports the
// app and only listens when run directly, so these tests exercise the
// actual middleware chain, the actual auth gates, and a real database.
//
// These live in test/routes/ rather than test/ on purpose: `npm test` only
// globs test/*.test.js, so the unit suite still runs with no database at
// all. `npm run test:routes` runs these, and needs DATABASE_URL set.
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const app = require("../../src/server");
const prisma = require("../../src/prismaClient");

const TEST_USERS = {
  admin: { email: "route-test-admin@example.test", role: "admin" },
  editor: { email: "route-test-editor@example.test", role: "editor" },
  viewer: { email: "route-test-viewer@example.test", role: "viewer" },
};
const TEST_PASSWORD = "RouteTestPassword123!";

let server;
// Memoized as a promise, not a flag: callers routinely start several
// clients concurrently (Promise.all), and a plain `if (server)` guard
// returns before the port has been assigned.
let startPromise;

function startServer() {
  if (!startPromise) {
    startPromise = new Promise((resolve) => {
      server = app.listen(0, () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
  }
  return startPromise;
}

// Disconnecting here, not just closing the HTTP server, matters: pg's connection pool defaults
// to a 10-second idleTimeoutMillis before Node's event loop can drain, and every route-test
// file is its own process, so without this each one lingers ~10s after its tests finish.
// Measured: a script that queries once and exits takes ~10.3s; calling prisma.$disconnect()
// first, ~0.3s.
async function stopServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  startPromise = null;
  await prisma.$disconnect();
}

// Creates the three role-fixture users once, so each test can log in as
// whichever role it needs to check a gate.
async function ensureTestUsers() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4); // low cost: these are throwaway
  for (const { email, role } of Object.values(TEST_USERS)) {
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role, active: true, authProvider: "local" },
      create: { email, passwordHash, role, active: true, authProvider: "local" },
    });
  }
}

async function removeTestUsers() {
  await prisma.user.deleteMany({
    where: { email: { in: Object.values(TEST_USERS).map((u) => u.email) } },
  });
}

// Logs in and returns a `request` function that carries the session cookie. Pass no role for
// an unauthenticated client. `role` is normally one of TEST_USERS' fixed keys
// (admin/editor/viewer); pass `{ email, password }` for a one-off account a test created
// itself.
async function client(roleOrCreds) {
  const base = await startServer();

  let cookie = "";
  if (roleOrCreds) {
    const isRole = typeof roleOrCreds === "string";
    const email = isRole ? TEST_USERS[roleOrCreds].email : roleOrCreds.email;
    const password = isRole ? TEST_PASSWORD : roleOrCreds.password;
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 200) throw new Error(`login as ${isRole ? roleOrCreds : email} failed: ${res.status}`);
    cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  return async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    // FormData must pass through untouched: fetch generates the multipart boundary itself, and
    // setting Content-Type by hand (or JSON-encoding it) leaves multer seeing no file.
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    if (options.body !== undefined && !isFormData && typeof options.body !== "string") {
      headers["Content-Type"] = "application/json";
      options = { ...options, body: JSON.stringify(options.body) };
    }
    const res = await fetch(`${base}${path}`, { ...options, headers });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    // `headers` is for the CSV export tests, which assert the Content-Type and attachment
    // filename; every other caller destructures { status, body }.
    return { status: res.status, body, headers: res.headers };
  };
}

// Every partner these tests create gets this marker on displayName so
// cleanup can find and remove them without touching seed data.
const FIXTURE_TAG = "[route-test]";

async function removeFixturePartners() {
  await prisma.partner.deleteMany({ where: { displayName: { contains: FIXTURE_TAG } } });
}

module.exports = {
  client,
  startServer,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
  TEST_PASSWORD,
  TEST_USERS,
};
