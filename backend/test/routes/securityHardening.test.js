// A guest never subscribes to, or receives, the church-wide email digests; a passkey setup
// token isn't good for an account that has since enrolled; the first passkey ends older
// sessions but not the tab that enrolled it; and removing a passkey (which checks the
// password) is rate limited.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const { DIGEST_ROLES } = require("../../src/utils/digestRoles");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");
const { createAuthenticator } = require("./softAuthenticator");

const PASSWORD = "HardeningTest123!";
const SITE = "https://church.example.test";
const emails = [];
let anon;
let editor;
let savedBase;
let original;

const cookieOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const as =
  (cookie) =>
  (path, options = {}) =>
    anon(path, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });

async function makeUser(tag, extra = {}) {
  const email = `route-test-hardening-${tag}@example.test`;
  emails.push(email);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const data = { passwordHash, role: "editor", active: true, authProvider: "local", ...extra };
  return prisma.user.upsert({
    where: { email },
    update: { mfaEnabled: false, mfaSecret: null, cadence: null, ...data },
    create: { email, ...data },
  });
}
const login = (email) => anon("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
const authenticator = () => createAuthenticator({ rpID: "church.example.test", origin: SITE });
async function register(who, a, headers) {
  const opts = await who("/api/auth/passkeys/register/options", { method: "POST", headers });
  if (opts.status !== 200) return opts;
  return who("/api/auth/passkeys/register/verify", {
    method: "POST",
    headers,
    body: { challengeToken: opts.body.challengeToken, response: a.register(opts.body.options.challenge) },
  });
}

before(async () => {
  await ensureTestUsers();
  anon = await client(null);
  editor = await client("editor");
  savedBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = SITE;
  original = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { requireTwoFactor: true, requirePasswordless: true },
  });
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { requireTwoFactor: false, requirePasswordless: false },
    create: { id: "singleton", requireTwoFactor: false },
  });
});

after(async () => {
  if (savedBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = savedBase;
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: {
      requireTwoFactor: original?.requireTwoFactor ?? false,
      requirePasswordless: original?.requirePasswordless ?? false,
    },
  });
  await removeTestUsers();
  await stopServer();
});

describe("the email digests are never a guest's, beyond their own partners (#407)", () => {
  test("a guest with no seat can't subscribe; with a seat they get only their own partners; a full role can pick any scope", async () => {
    const guest = await makeUser("guest", { role: "guest" });
    const features = (await prisma.churchSettings.findUnique({ where: { id: "singleton" } })).enabledFeatures;
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { enabledFeatures: { ...features, careTeam: true } },
    });
    const partner = await prisma.partner.create({
      data: { kind: "missionary", displayName: "[route-test] hardening", sentByOurChurch: false },
    });
    try {
      const cookie = cookieOf(await login(guest.email));
      // No seat yet: nothing to subscribe to (and the session itself is refused, with no reach).
      const none = await as(cookie)("/api/auth/dispatch-by-email", {
        method: "PUT",
        body: { cadence: "biweekly", digestScope: "owned" },
      });
      assert.ok([401, 403].includes(none.status), `a guest with no seat is refused (got ${none.status})`);
      assert.equal((await prisma.user.findUnique({ where: { id: guest.id } })).cadence, null);

      await prisma.careTeamMember.create({ data: { partnerId: partner.id, userId: guest.id } });
      const seated = cookieOf(await login(guest.email));
      // Asking for "all" is stored as "owned": a guest's digest can never widen.
      const res = await as(seated)("/api/auth/dispatch-by-email", {
        method: "PUT",
        body: { cadence: "biweekly", digestScope: "all" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.digestScope, "owned");
      const row = await prisma.user.findUnique({ where: { id: guest.id } });
      assert.equal(row.cadence, "biweekly");
      assert.equal(row.digestScope, "owned");
    } finally {
      await prisma.partner.delete({ where: { id: partner.id } });
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { enabledFeatures: features } });
    }
    const ok = await editor("/api/auth/dispatch-by-email", {
      method: "PUT",
      body: { cadence: "monthly", digestScope: "all" },
    });
    assert.equal(ok.status, 200);
    await editor("/api/auth/dispatch-by-email", { method: "PUT", body: { cadence: null } });
  });

  test("the church-wide subscriber count is the full roles only, and a stored guest cadence isn't counted", async () => {
    assert.deepEqual(DIGEST_ROLES, ["admin", "editor", "viewer"]);
    const before = await prisma.user.count({
      where: { cadence: { not: null }, active: true, role: { in: DIGEST_ROLES } },
    });
    const guest = await makeUser("guest-cadence", { role: "guest", cadence: "biweekly" });
    assert.equal(
      await prisma.user.count({
        where: { cadence: { not: null }, active: true, role: { in: DIGEST_ROLES } },
      }),
      before
    );
    const admin = await client("admin");
    const summary = await admin("/api/scoped-digest/summary");
    assert.equal(summary.status, 200);
    assert.equal(
      summary.body.adminSubscribedCount,
      await prisma.user.count({
        where: { cadence: { not: null }, active: true, role: { in: DIGEST_ROLES } },
      }),
      `the guest ${guest.id} isn't in the count`
    );
  });
});

describe("passkey enrolment (#408)", () => {
  test("a setup token is refused once the account has enrolled", async () => {
    await prisma.churchSettings.update({ where: { id: "singleton" }, data: { requireTwoFactor: true } });
    try {
      const user = await makeUser("setup-token");
      const first = await login(user.email);
      assert.ok(first.body.setupToken, "sent to enrolment");
      const bearer = { Authorization: `Bearer ${first.body.setupToken}` };
      const withToken = (path, options = {}) =>
        anon(path, { ...options, headers: { ...bearer, ...(options.headers || {}) } });
      // Meanwhile the person (or an admin) enrols a factor.
      await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
      const res = await register(withToken, authenticator(), undefined);
      assert.equal(res.status, 401);
      assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 0);
    } finally {
      await prisma.churchSettings.update({ where: { id: "singleton" }, data: { requireTwoFactor: false } });
    }
  });

  test("the first passkey ends older sessions, but the tab that added it stays signed in", async () => {
    const user = await makeUser("first-passkey");
    const older = cookieOf(await login(user.email));
    const current = cookieOf(await login(user.email));
    const enrolled = await register(as(current), authenticator());
    assert.equal(enrolled.status, 200);
    // The response re-issues this tab's cookie from the updated account.
    assert.equal(
      (await as(cookieOf(enrolled))("/api/auth/me")).status,
      200,
      "the enrolling tab keeps its session"
    );
    assert.equal((await as(older)("/api/auth/me")).status, 401, "a session opened before enrolment ends");
  });
});

describe("removing a passkey is rate limited (#408)", () => {
  test("wrong-password attempts are refused after ten", async () => {
    const user = await makeUser("limiter");
    const cookie = cookieOf(await login(user.email));
    const enrolled = await register(as(cookie), authenticator());
    assert.equal(enrolled.status, 200);
    const who = as(cookieOf(enrolled));
    const [passkey] = (await who("/api/auth/passkeys")).body.passkeys;
    let last;
    for (let i = 0; i < 12; i++) {
      last = await who(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE", body: { password: "wrong" } });
    }
    assert.equal(last.status, 429);
    assert.equal(await prisma.userPasskey.count({ where: { userId: user.id } }), 1, "never removed");
  });
});
