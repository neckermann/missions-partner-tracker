const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

// Must be set before requireAuth.js is required, and before any token is
// signed below — both read process.env.SESSION_SECRET at call time.
process.env.SESSION_SECRET = "test-secret-not-for-production";

const { requireAuth, requireRole, requireAuthOrMfaSetup } = require("../src/middleware/requireAuth");

function signToken(claims, opts = {}) {
  return jwt.sign(claims, process.env.SESSION_SECRET, opts);
}

// Minimal fake req/res — just enough surface for these middleware
// functions. The session lives in an httpOnly cookie now, so this builds
// req.cookies (what cookie-parser would populate), not an Authorization
// header — except fakeReqBearer, for the one remaining bearer-token case
// (the forced-MFA-setup token, passed explicitly since there's no session
// cookie yet at that point in the flow).
function fakeReq(token) {
  return { cookies: token ? { session: token } : {}, headers: {} };
}

function fakeReqBearer(token) {
  return { cookies: {}, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
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

  test("accepts a valid full session cookie and attaches req.user", () => {
    const token = signToken({ id: "u1", role: "admin" });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuth(req, res, next);
    assert.equal(next.calls.length, 1);
    assert.equal(req.user.id, "u1");
    assert.equal(req.user.role, "admin");
    assert.equal(res.statusCode, null);
  });
});

describe("requireRole", () => {
  test("allows a user whose role is in the allowed list", () => {
    const token = signToken({ id: "u1", role: "admin" });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireRole("admin", "editor")(req, res, next);
    assert.equal(next.calls.length, 1);
  });

  test("rejects a user whose role is not in the allowed list", () => {
    const token = signToken({ id: "u1", role: "viewer" });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireRole("admin")(req, res, next);
    assert.equal(res.statusCode, 403);
    assert.equal(next.calls.length, 0);
  });

  test("still rejects unauthenticated requests before checking role", () => {
    const req = fakeReq(null);
    const res = fakeRes();
    const next = spyNext();
    requireRole("admin")(req, res, next);
    assert.equal(res.statusCode, 401);
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

  test("accepts a forced-MFA-setup token via Authorization header — the one place bearer auth still exists, since there's no session cookie yet at this point in the flow", () => {
    const token = signToken({ id: "u1", mfaSetup: true });
    const req = fakeReqBearer(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuthOrMfaSetup(req, res, next);
    assert.equal(next.calls.length, 1);
    assert.equal(req.user.mfaSetup, true);
  });

  test("accepts a full session via the cookie", () => {
    const token = signToken({ id: "u1", role: "editor" });
    const req = fakeReq(token);
    const res = fakeRes();
    const next = spyNext();
    requireAuthOrMfaSetup(req, res, next);
    assert.equal(next.calls.length, 1);
  });
});
