const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const { client, stopServer } = require("./helpers");

describe("GET /api/silhouette/:category.svg -- public, no session required", () => {
  let unauthenticated;

  before(async () => {
    unauthenticated = await client();
  });

  after(async () => {
    await stopServer();
  });

  test("serves real SVG markup as image/svg+xml, not a data URI", async () => {
    const res = await unauthenticated("/api/silhouette/couple.svg");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type").startsWith("image/svg+xml"), true);
    assert.equal(res.body.startsWith("<svg"), true);
  });

  test("falls back to the single-person shape for an unknown category, same as silhouetteFor", async () => {
    const known = await unauthenticated("/api/silhouette/single.svg");
    const unknown = await unauthenticated("/api/silhouette/not-a-real-category.svg");
    assert.equal(unknown.body, known.body);
  });
});
