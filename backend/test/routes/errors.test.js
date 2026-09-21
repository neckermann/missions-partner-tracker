const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
// Explicit rather than relying on ./helpers being required first --
// prismaClient reads DATABASE_URL at construction, so importing it before
// something has loaded .env fails with an opaque SASL error.
require("dotenv").config({ quiet: true });
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

// The contract this file defends: **every error response body's `error` is a
// string.**
//
// It has broken twice on the same line of code. First `res.json({ error:
// err.errors })` serialized to a literal {} after Zod v4 renamed
// ZodError.errors to .issues, so a rejected save said nothing about what was
// wrong. The fix sent `err.issues` -- an array of objects -- which the
// frontend renders straight into JSX, so React threw "Objects are not valid
// as a React child" and, with no error boundary, unmounted the whole page.
// Every validation error was a white screen.
//
// Both bugs were invisible to a test suite that only checked status codes.
// So this walks every validating endpoint and asserts the body shape, not
// just the number. Adding a route to the table below protects it too.

let admin;
let partner;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  await removeFixturePartners();
  const created = await admin("/api/partners", {
    method: "POST",
    body: { kind: "missionary", displayName: `${FIXTURE_TAG} error host` },
  });
  partner = created.body;
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

// One deliberately-invalid body per validating endpoint. `expect` is a
// fragment the message must contain -- usually the offending field's name,
// because naming the field is what makes the error actionable.
function invalidBodyCases() {
  return [
    {
      name: "partners: bad enum",
      path: "/api/partners",
      body: { kind: "not-a-kind", displayName: "x" },
      expect: /kind/,
    },
    {
      name: "partners: missing required field",
      path: "/api/partners",
      body: { kind: "missionary" },
      expect: /displayName/,
    },
    {
      name: "trips: missing partnerId",
      path: "/api/trips",
      body: { tripType: "Construction" },
      expect: /partnerId/,
    },
    {
      name: "support-entries: amount is not a number",
      path: "/api/support-entries",
      body: { partnerId: () => partner.id, amount: "lots", effectiveDate: "2026-01-01" },
      expect: /amount/,
    },
    {
      name: "support-needs: missing requestedAmount",
      path: "/api/support-needs",
      body: { partnerId: () => partner.id, description: "A need", requestDate: "2026-01-01" },
      expect: /requestedAmount/,
    },
    {
      name: "prayer-requests: bad category",
      path: "/api/prayer-requests",
      body: {
        partnerId: () => partner.id,
        category: "whenever",
        requestText: "A request",
        dateReceived: "2026-01-01",
      },
      expect: /category/,
    },
    {
      name: "users: missing email",
      path: "/api/users",
      body: { name: "No Email", role: "viewer", password: "LongEnoughPassword1!" },
      expect: /email/,
    },
  ];
}

describe("error contract: validation failures", () => {
  for (const c of invalidBodyCases()) {
    test(`${c.name} -> 400 with a string naming the field`, async () => {
      // Values given as functions are resolved here, since the fixture
      // partner doesn't exist when the table is built.
      const body = Object.fromEntries(
        Object.entries(c.body).map(([k, v]) => [k, typeof v === "function" ? v() : v])
      );

      const res = await admin(c.path, { method: "POST", body });

      assert.equal(res.status, 400, `expected 400, got ${res.status}`);
      assert.equal(
        typeof res.body.error,
        "string",
        `error must be a string the UI can render, got ${JSON.stringify(res.body.error)}`
      );
      assert.ok(res.body.error.length > 0, "error must not be empty");
      assert.match(res.body.error, c.expect);
    });
  }
});

describe("error contract: other failure modes", () => {
  const MISSING_ID = "00000000-0000-4000-8000-000000000000";

  test("an unknown id on update is 404, not 500", async () => {
    // users.js used to catch only ZodError here, so Prisma's P2025 fell
    // through to the generic handler and surfaced as a 500.
    const res = await admin(`/api/users/${MISSING_ID}`, {
      method: "PUT",
      body: { name: "Nobody", role: "viewer" },
    });
    assert.equal(res.status, 404);
    assert.equal(typeof res.body.error, "string");
  });

  test("an unknown id on delete is 404, not 500", async () => {
    const res = await admin(`/api/users/${MISSING_ID}`, { method: "DELETE" });
    assert.equal(res.status, 404);
    assert.equal(typeof res.body.error, "string");
  });

  test("a duplicate email is 409, naming the conflict", async () => {
    const email = `${Date.now()}-dupe@example.test`;
    const body = { email, name: "First", role: "viewer", password: "LongEnoughPassword1!" };

    const first = await admin("/api/users", { method: "POST", body });
    assert.equal(first.status, 201);

    try {
      const second = await admin("/api/users", { method: "POST", body });
      assert.equal(second.status, 409);
      assert.equal(typeof second.body.error, "string");
      assert.match(second.body.error, /already in use/i);
    } finally {
      await admin(`/api/users/${first.body.id}`, { method: "DELETE" });
    }
  });

  test("a malformed JSON body is 400, not 500", async () => {
    const res = await admin("/api/partners", {
      method: "POST",
      body: "{ this is not json",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, "string");
  });

  test("an unexpected failure never leaks internals to the client", async () => {
    // A syntactically-valid but nonexistent id shape: whatever goes wrong
    // inside, the caller must not receive schema or column names.
    const res = await admin("/api/partners/not-a-real-uuid-at-all");
    assert.ok(res.status >= 400);
    assert.equal(typeof res.body.error, "string");
    assert.doesNotMatch(res.body.error, /prisma|invocation|column|\.ts:|at /i);
  });
});
