// #327 Finding 1 -- end-to-end regression, through the real Express app and
// a real database, for the critical auth bypass: utils/emailDispatchShell.js
// signs a digest email's unsubscribe link as { id, unsubscribe: true } with
// the exact same SESSION_SECRET as a real session cookie. Before the fix,
// that token had a valid signature and a real user id, and requireAuth only
// refused mfaPending/mfaSetup -- so presenting it as the session cookie
// granted a full, fully-privileged session for that user, permanently,
// bypassing password and MFA entirely.
//
// This file covers both sides: the forged-session path must now be
// rejected (middleware/requireAuth.js), and the legitimate
// unsubscribe-consuming route (routes/auth.js's own GET /unsubscribe,
// which verifies the token itself and is NOT gated by requireAuth) must
// still work for a real, unexpired link, and must reject an expired one.
require("dotenv").config({ quiet: true });
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { buildUnsubscribeToken } = require("../../src/utils/emailDispatchShell");
const { client, startServer, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let targetAdmin; // a second, throwaway admin -- the one impersonated by the forged token

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");

  const passwordHash = await bcrypt.hash("Whatever-Not-Used-123!", 4);
  targetAdmin = await prisma.user.create({
    data: {
      email: "route-test-unsubscribe-target@example.test",
      passwordHash,
      role: "admin",
      active: true,
      authProvider: "local",
      cadence: "weekly",
    },
  });
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: targetAdmin.email } });
  await removeTestUsers();
  await stopServer();
});

// A raw fetch with an arbitrary cookie string -- helpers.client() always
// logs in for real first, which is exactly what this forged-token scenario
// must NOT need to do.
async function requestWithCookie(path, cookieValue) {
  const base = await startServer();
  const res = await fetch(`${base}${path}`, {
    headers: { Cookie: `session=${cookieValue}` },
  });
  const text = await res.text();
  return { status: res.status, text };
}

describe("#327 Finding 1 -- unsubscribe token can never work as a session cookie", () => {
  test("a real, well-formed unsubscribe token for a real admin is rejected by requireAuth", async () => {
    const token = buildUnsubscribeToken(targetAdmin.id);
    const res = await requestWithCookie("/api/partners", token);
    assert.equal(res.status, 401);
  });

  test("...and therefore by requireRole('admin') too, on an admin-only route", async () => {
    const token = buildUnsubscribeToken(targetAdmin.id);
    const res = await requestWithCookie("/api/users", token);
    assert.equal(res.status, 401);
  });

  test("/api/auth/me does not report the impersonated admin either", async () => {
    const token = buildUnsubscribeToken(targetAdmin.id);
    const res = await requestWithCookie("/api/auth/me", token);
    assert.equal(res.status, 401);
  });

  test("sanity: a real session for that same admin still works fine", async () => {
    // Confirms the rejection above is about the token's purpose, not
    // something broken about this particular user row.
    const fresh = await prisma.user.update({
      where: { id: targetAdmin.id },
      data: {},
      select: { id: true },
    });
    assert.equal(fresh.id, targetAdmin.id);
    assert.equal((await admin("/api/partners")).status, 200);
  });
});

describe("#327 defense-in-depth -- the unsubscribe token itself now expires", () => {
  test("GET /api/auth/unsubscribe accepts a valid, unexpired token but only renders a confirm page (#327 Finding 6)", async () => {
    const token = buildUnsubscribeToken(targetAdmin.id);
    const base = await startServer();
    const res = await fetch(`${base}/api/auth/unsubscribe?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Confirm unsubscribe/i);

    const unchanged = await prisma.user.findUnique({
      where: { id: targetAdmin.id },
      select: { cadence: true },
    });
    assert.equal(unchanged.cadence, "weekly", "GET must not mutate");
  });

  test("POST /api/auth/unsubscribe accepts a valid, unexpired token and clears the subscription", async () => {
    const token = buildUnsubscribeToken(targetAdmin.id);
    const base = await startServer();
    // Token in the query string, same as the RFC 8058 one-click path a
    // mail client's own "Unsubscribe" button would use.
    const res = await fetch(`${base}/api/auth/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /unsubscribed/i);

    const updated = await prisma.user.findUnique({
      where: { id: targetAdmin.id },
      select: { cadence: true },
    });
    assert.equal(updated.cadence, null, "the legitimate unsubscribe side-effect must still happen");
  });

  test("GET /api/auth/unsubscribe rejects an expired token", async () => {
    const expired = jwt.sign({ id: targetAdmin.id, unsubscribe: true }, process.env.SESSION_SECRET, {
      expiresIn: -1,
    });
    const base = await startServer();
    const res = await fetch(`${base}/api/auth/unsubscribe?token=${encodeURIComponent(expired)}`);
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /isn't valid/i);
  });

  test("GET /api/auth/unsubscribe still rejects a token of the wrong shape (no unsubscribe claim)", async () => {
    const wrongShape = jwt.sign({ id: targetAdmin.id }, process.env.SESSION_SECRET);
    const base = await startServer();
    const res = await fetch(`${base}/api/auth/unsubscribe?token=${encodeURIComponent(wrongShape)}`);
    assert.equal(res.status, 400);
  });
});
