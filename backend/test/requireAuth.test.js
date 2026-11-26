const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");

// Must be set before requireAuth.js is required, and before any token is
// signed below — both read process.env.SESSION_SECRET at call time.
process.env.SESSION_SECRET = "test-secret-not-for-production";

const { requireAuth, requireRole, requireAuthOrMfaSetup } = require("../src/middleware/requireAuth");

// These cover everything the middleware decides before it looks anything up: a missing,
// malformed, expired, wrong-secret or wrong-kind token is rejected on the token alone, so a
// rejected request never costs a database query. The accepting paths are in
// test/routes/revocation.test.js: requireAuth reads the user on every request (so
// deactivating, deleting or demoting someone takes effect immediately), which means a valid
// token alone is not sufficient and "accepts a valid token" can't be asserted without a real
// row; that file also checks req.user.role comes from the database, not the token's claims.

function signToken(claims, opts = {}) {
  return jwt.sign(claims, process.env.SESSION_SECRET, opts);
}

// Minimal fake req/res, just enough surface for these middleware functions. The session lives
// in an httpOnly cookie, so this builds req.cookies (what cookie-parser would populate);
// fakeReqBearer is the one bearer-token case (the forced-MFA-setup token, since there's no
// session cookie yet at that point).
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

  // utils/emailDispatchShell.js signs a digest email's unsubscribe link as { id, unsubscribe:
  // true } with this same SESSION_SECRET. That token has a valid signature and a real user id
  // with neither mfaPending nor mfaSetup set, so without an explicit check it would be accepted
  // as a fully-privileged session for that id (role read from the DB), bypassing password and
  // MFA. The exact shape buildUnsubscribeToken() produces must never be accepted as a session.
  test("rejects an unsubscribe token presented as a session cookie (#327)", () => {
    const token = signToken({ id: "real-admin-uuid", unsubscribe: true });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0, "must never reach the DB lookup / req.user assignment");
  });

  test("rejects an unsubscribe token even with a short, still-valid expiry (#327)", () => {
    const token = signToken({ id: "real-admin-uuid", unsubscribe: true }, { expiresIn: "90d" });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
  });
});

// A browser clicking a direct link to a requireAuth-gated route (a GroupMe notification, etc.)
// with no session should land on a login form, not bare JSON, while every SPA/API caller above
// keeps getting plain JSON, since nothing in the frontend expects a redirect.
describe("requireAuth — browser navigation redirects", () => {
  test("no cookie, a real browser's Accept header -- redirects to /login with the original URL preserved", () => {
    const req = fakeReq(null, {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      originalUrl: "/api/partner-files/42/download",
    });
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(res.redirectedTo, "/login?next=%2Fapi%2Fpartner-files%2F42%2Fdownload");
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

  // requireRole wraps requireAuth, so a role-gated route (e.g. backups.js's
  // requireRole("admin")) inherits the browser-redirect behavior for the no-session case.
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

  // requireRole wraps requireAuth and reads role from the DB, so an unsubscribe token for a real
  // admin id would otherwise grant admin access: confirm the rejection happens before role is
  // consulted.
  test("rejects an unsubscribe token before ever reaching the role check (#327)", async () => {
    const token = signToken({ id: "real-admin-uuid", unsubscribe: true });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    await requireRole("admin")(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
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

  // This function accepts the session cookie or a bearer token and ends (via /mfa/setup +
  // /mfa/verify-setup -> completeLogin) in a real session cookie, so it would be a second path
  // to the same bypass if the unsubscribe token weren't rejected here too.
  test("rejects an unsubscribe token presented as a session cookie (#327)", () => {
    const token = signToken({ id: "real-admin-uuid", unsubscribe: true });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuthOrMfaSetup(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
  });

  test("rejects an unsubscribe token presented as a bearer token (#327)", () => {
    const token = signToken({ id: "real-admin-uuid", unsubscribe: true });
    const req = fakeReqBearer(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuthOrMfaSetup(req, res, next);
    assert.equal(res.statusCode, 401);
    assert.equal(next.calls.length, 0);
  });
});
