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

async function stopServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  startPromise = null;
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

// Logs in and returns a `request` function that carries the session cookie.
// Pass no role for an unauthenticated client.
async function client(role) {
  const base = await startServer();

  let cookie = "";
  if (role) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_USERS[role].email, password: TEST_PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login as ${role} failed: ${res.status}`);
    cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }

  return async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    // FormData must pass through untouched -- fetch generates the multipart
    // boundary itself, and setting Content-Type by hand (or JSON-encoding
    // it, as this used to) leaves multer seeing no file at all.
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
    return { status: res.status, body };
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
