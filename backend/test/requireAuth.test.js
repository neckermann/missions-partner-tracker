const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");

// Must be set before requireAuth.js is required, and before any token is
// signed below — both read process.env.SESSION_SECRET at call time.
process.env.SESSION_SECRET = "test-secret-not-for-production";

const { requireAuth, requireRole, requireAuthOrMfaSetup } = require("../src/middleware/requireAuth");

// These cover everything the middleware decides **before** it looks anything
// up: a missing, malformed, expired, wrong-secret, or wrong-kind token is
// rejected on the token alone. That is worth pinning on its own -- a
// rejected request should never cost a database query.
//
// The accepting paths moved to test/routes/, because requireAuth now reads
// the user on every request so that deactivating, deleting or demoting
// someone takes effect immediately instead of at token expiry. A valid
// token is no longer sufficient by itself, so "accepts a valid token"
// cannot be asserted without a real row. See test/routes/revocation.test.js
// for that side, including that req.user.role comes from the database
// rather than the token's claims.

function signToken(claims, opts = {}) {
  return jwt.sign(claims, process.env.SESSION_SECRET, opts);
}

// Minimal fake req/res — just enough surface for these middleware
// functions. The session lives in an httpOnly cookie now, so this builds
// req.cookies (what cookie-parser would populate), not an Authorization
// header — except fakeReqBearer, for the one remaining bearer-token case
// (the forced-MFA-setup token, passed explicitly since there's no session
// cookie yet at that point in the flow).
function fakeReq(token, opts = {}) {
  return {
    cookies: token ? { session: token } : {},
    headers: opts.headers || {},
    method: opts.method || "GET",
    originalUrl: opts.originalUrl || "/api/example",
  };
}

function fakeReqBearer(token) {
  return { cookies: {}, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

function fakeRes() {
  const res = { statusCode: null, body: null, redirectedTo: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.redirect = (url) => {
    res.redirectedTo = url;
    return res;
  };
  return res;
}

function spyNext() {
  const calls = [];
  const next = (...args) => calls.push(args);
  next.calls = calls;
  return next;
}

describe("requireAuth", () => {
  test("rejects a request with no session cookie", () => {
    const req = fakeReq(null);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
  });

  test("ignores an Authorization header — cookie is the only accepted source", () => {
    const token = signToken({ id: "u1", role: "admin" });
    const req = fakeReqBearer(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
  });

  test("rejects a malformed/invalid token", () => {
    const req = fakeReq("not-a-real-token");
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "Invalid or expired session");
  });

  test("rejects an expired token", () => {
    const token = signToken({ id: "u1" }, { expiresIn: -1 });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
  });

  test("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ id: "u1" }, "wrong-secret");
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
  });

  test("rejects a pending-MFA token (password checked, second factor not yet verified)", () => {
    const token = signToken({ id: "u1", mfaPending: true });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "MFA verification required");
    assert.equal(next.calls.length, 0);
  });

  test("rejects a forced-MFA-setup token", () => {
    const token = signToken({ id: "u1", mfaSetup: true });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
  });
});

// #124: a real browser clicking a direct link to a requireAuth-gated route
// (a GroupMe notification, etc.) with no session should land on a login
// form, not bare JSON -- but every existing SPA/API caller above must keep
// getting plain JSON, since nothing in the frontend expects a redirect.
describe("requireAuth — browser navigation redirects", () => {
  test("no cookie, a real browser's Accept header -- redirects to /login with the original URL preserved", () => {
    const req = fakeReq(null, {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      originalUrl: "/api/newsletters/42/download",
    });
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.redirectedTo, "/login?next=%2Fapi%2Fnewsletters%2F42%2Fdownload");
    assert.equal(res.statusCode, null, "the JSON path must not also have run");
    assert.equal(next.calls.length, 0);
  });

  // The regression guard for the ambiguous-negotiation risk: a bare "*/*"
  // (the default Accept header for many non-browser HTTP clients) must NOT
  // be treated as "wants html" -- only an Accept header that literally
  // contains text/html does.
  test("no cookie, a bare */* Accept header -- stays plain JSON", () => {
    const req = fakeReq(null, { headers: { accept: "*/*" } });
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "Authentication required");
    assert.equal(res.redirectedTo, null);
  });

  test("no cookie, no Accept header at all -- stays plain JSON (today's existing callers)", () => {
    const req = fakeReq(null);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(res.redirectedTo, null);
  });

  test("invalid/expired token, browser GET -- also redirects", () => {
    const req = fakeReq("not-a-real-token", { headers: { accept: "text/html" } });
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.ok(res.redirectedTo?.startsWith("/login?next="));
  });

  test("pending-MFA token, browser GET -- also redirects (no special-casing to the TOTP step)", () => {
    const token = signToken({ id: "u1", mfaPending: true });
    const req = fakeReq(token, { headers: { accept: "text/html" } });
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.ok(res.redirectedTo?.startsWith("/login?next="));
  });

  test("browser Accept header but a POST request -- stays plain JSON, never redirects a write", () => {
    const req = fakeReq(null, { method: "POST", headers: { accept: "text/html" } });
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(res.redirectedTo, null);
  });
});

describe("requireRole", () => {
  test("still rejects unauthenticated requests before checking role", () => {
    const req = fakeReq(null);
    const res = fakeRes();
    const next = spyNext();
    requireRole("admin")(req, res, next);
    assert.equal(res.statusCode, 401);
  });

  // #124: requireRole wraps requireAuth, so a role-gated route (e.g.
  // backups.js's requireRole("admin")) inherits the browser-redirect
  // behavior for the "no session at all" case with zero code change of
  // its own.
  test("no cookie, browser GET through a role-gated route -- redirects the same as requireAuth alone", async () => {
    const req = fakeReq(null, {
      headers: { accept: "text/html" },
      originalUrl: "/api/backups/download",
    });
    const res = fakeRes();
    const next = spyNext();
    await requireRole("admin")(req, res, next);
    assert.equal(res.redirectedTo, "/login?next=%2Fapi%2Fbackups%2Fdownload");
  });
});

describe("requireAuthOrMfaSetup", () => {
  test("rejects a pending-MFA token", () => {
    const token = signToken({ id: "u1", mfaPending: true });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuthOrMfaSetup(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
  });
});
