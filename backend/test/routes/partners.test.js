const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

let admin;
let editor;
let viewer;
let anon;

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, anon] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(null),
  ]);
  await removeFixturePartners();
});

after(async () => {
  await removeFixturePartners();
  await removeTestUsers();
  await stopServer();
});

async function createPartner(overrides = {}) {
  const res = await admin("/api/partners", {
    method: "POST",
    body: {
      kind: "missionary",
      displayName: `${FIXTURE_TAG} ${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, `create failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

describe("partners: auth gates", () => {
  test("unauthenticated requests are rejected", async () => {
    assert.equal((await anon("/api/partners")).status, 401);
    assert.equal(
      (await anon("/api/partners", { method: "POST", body: { kind: "missionary", displayName: "x" } }))
        .status,
      401
    );
  });

  test("a viewer can read but not write", async () => {
    assert.equal((await viewer("/api/partners")).status, 200);
    const res = await viewer("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} viewer-attempt` },
    });
    assert.equal(res.status, 403);
  });

  test("an editor can write but cannot delete", async () => {
    const p = await createPartner();
    assert.equal(
      (await editor(`/api/partners/${p.id}`, { method: "PUT", body: { overview: "ok" } })).status,
      200
    );
    await editor(`/api/partners/${p.id}/archive`, { method: "POST" });
    assert.equal((await editor(`/api/partners/${p.id}`, { method: "DELETE" })).status, 403);
  });
});

describe("partners: validation", () => {
  // Regression test for two bugs in a row on the same line of code. First
  // every 400 serialized to a literal {}, because Zod v4 renamed
  // ZodError.errors to .issues. The fix returned err.issues -- an array of
  // objects -- which the frontend renders straight into JSX, so React threw
  // "Objects are not valid as a React child" and blanked the page.
  //
  // So the contract is now both halves at once: the body must name the
  // offending field, AND it must be a string. See middleware/errors.js.
  test("a validation error names the offending field, as a string", async () => {
    const res = await admin("/api/partners", {
      method: "POST",
      body: { kind: "not-a-kind", displayName: "x" },
    });
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, "string", `expected a string, got ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /kind/);
  });

  test("a missing required field is rejected", async () => {
    const res = await admin("/api/partners", { method: "POST", body: { kind: "missionary" } });
    assert.equal(res.status, 400);
    assert.equal(typeof res.body.error, "string");
    assert.match(res.body.error, /displayName/);
  });

  test("an unknown id returns 404, not 500", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.equal((await admin(`/api/partners/${missing}`)).status, 404);
    assert.equal(
      (await admin(`/api/partners/${missing}`, { method: "PUT", body: { overview: "x" } })).status,
      404
    );
  });

  // An unmatched /api path used to fall through to the SPA catch-all and
  // come back as index.html with a 200 -- so a client calling a removed
  // endpoint (say /api/missionaries after the v2.0.0 merge) got HTML and a
  // confusing parse error rather than a clear 404.
  test("an unmatched /api path returns a JSON 404, not the SPA shell", async () => {
    const res = await admin("/api/missionaries");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "Not found" });

    const nonsense = await admin("/api/definitely-not-a-route");
    assert.equal(nonsense.status, 404);
    assert.deepEqual(nonsense.body, { error: "Not found" });
  });
});

describe("partners: read models", () => {
  test("the list returns summary rows, not every relation", async () => {
    await createPartner();
    const { status, body } = await admin("/api/partners");
    assert.equal(status, 200);
    const row = body[0];
    // The whole point of the summary select: a list row must not drag a
    // partner's entire history across the wire.
    for (const absent of [
      "trips",
      "needRequests",
      "prayerRequests",
      "newsletters",
      "documents",
      "adults",
      "children",
    ]) {
      assert.ok(!(absent in row), `summary row should not include ${absent}`);
    }
    assert.ok("displayName" in row && "kind" in row);
  });

  test("the detail record includes its own sub-records but not the history collections", async () => {
    const p = await createPartner({ adults: [{ name: "Test Adult" }] });
    const { status, body } = await admin(`/api/partners/${p.id}`);
    assert.equal(status, 200);
    assert.equal(body.adults.length, 1);
    for (const absent of [
      "trips",
      "supportEntries",
      "needRequests",
      "prayerRequests",
      "newsletters",
      "documents",
    ]) {
      assert.ok(!(absent in body), `detail record should not include ${absent}`);
    }
  });

  test("kind and archived filters work", async () => {
    const org = await createPartner({ kind: "organization", orgType: "Local" });
    const orgs = await admin("/api/partners?kind=organization");
    assert.ok(orgs.body.some((r) => r.id === org.id));
    const missionaries = await admin("/api/partners?kind=missionary");
    assert.ok(!missionaries.body.some((r) => r.id === org.id));

    await admin(`/api/partners/${org.id}/archive`, { method: "POST" });
    const active = await admin("/api/partners?archived=false");
    assert.ok(!active.body.some((r) => r.id === org.id), "archived partner must be excluded");
  });
});

describe("partners: collections are not writable through the partner record", () => {
  // This is the regression test for the data-loss bug. Before the rebuild,
  // saving a partner replaced every child collection wholesale from the
  // request body -- so a stale form could silently delete rows added
  // through a collection's own endpoint since the form was opened.
  test("a partner save cannot delete rows owned by a collection endpoint", async () => {
    const p = await createPartner();

    const trip = await admin("/api/trips", {
      method: "POST",
      body: { partnerId: p.id, tripType: "Construction", participants: [{ name: "Someone" }] },
    });
    assert.equal(trip.status, 201);
    const entry = await admin("/api/support-entries", {
      method: "POST",
      body: { partnerId: p.id, amount: 250, effectiveDate: "2026-01-01" },
    });
    assert.equal(entry.status, 201);

    // Save the partner while explicitly sending empty collection arrays --
    // exactly what a stale edit form used to do.
    const saved = await admin(`/api/partners/${p.id}`, {
      method: "PUT",
      body: {
        overview: "edited",
        trips: [],
        supportEntries: [],
        needRequests: [],
        prayerRequests: [],
        newsletters: [],
        documents: [],
      },
    });
    assert.equal(saved.status, 200);

    const trips = await admin(`/api/trips?partnerId=${p.id}`);
    const entries = await admin(`/api/support-entries?partnerId=${p.id}`);
    assert.equal(trips.body.length, 1, "trip must survive a partner save");
    assert.equal(trips.body[0].id, trip.body.id, "trip id must be unchanged, not recreated");
    assert.equal(entries.body.length, 1, "support entry must survive a partner save");
    assert.equal(entries.body[0].id, entry.body.id, "support entry id must be unchanged");

    const after = await admin(`/api/partners/${p.id}`);
    assert.equal(after.body.overview, "edited", "the scalar edit should still apply");
  });

  test("sub-records the partner record does own are still replaced on save", async () => {
    const p = await createPartner({ adults: [{ name: "First" }] });
    await admin(`/api/partners/${p.id}`, { method: "PUT", body: { adults: [{ name: "Second" }] } });
    const { body } = await admin(`/api/partners/${p.id}`);
    assert.equal(body.adults.length, 1);
    assert.equal(body.adults[0].name, "Second");
  });
});

describe("partners: archive before delete", () => {
  test("deleting an unarchived partner is refused", async () => {
    const p = await createPartner();
    const res = await admin(`/api/partners/${p.id}`, { method: "DELETE" });
    assert.equal(res.status, 400);
  });

  test("archiving zeroes support, unpublishes, then permits delete", async () => {
    const p = await createPartner({ isPublic: true });
    const archived = await admin(`/api/partners/${p.id}/archive`, { method: "POST" });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.archived, true);
    assert.equal(archived.body.isPublic, false, "archiving must pull the record off the public site");

    const entries = await admin(`/api/support-entries?partnerId=${p.id}`);
    assert.equal(entries.body[0].amount, 0, "archiving records a $0 support entry");

    assert.equal((await admin(`/api/partners/${p.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await admin(`/api/partners/${p.id}`)).status, 404);
  });
});
