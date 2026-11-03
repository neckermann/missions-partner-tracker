const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { startServer, stopServer } = require("./helpers");

// #124: confirms the requireAuth browser-redirect behavior (unit-tested in
// isolation in test/requireAuth.test.js) is actually wired into a real
// route -- requireAuth runs before requireFeature/the handler itself, so
// this needs no fixture data, just an unauthenticated browser-style GET.
describe("GET a requireAuth-gated download route, unauthenticated, as a real browser", () => {
  after(stopServer);

  test("redirects to /login with the original path preserved, instead of bare JSON", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/newsletters/any-id/download`, {
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/login?next=%2Fapi%2Fnewsletters%2Fany-id%2Fdownload");
  });

  test("a plain API-style request to the same route still gets JSON, unchanged", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/api/newsletters/any-id/download`, {
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Authentication required");
  });
});
