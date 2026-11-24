// #327 Finding 11.4 -- primaryColor/headerColor/highlightColor/brandFont
// used to accept any string, stored verbatim and later dropped straight
// into a style="..." attribute in every rendered email and confirm page
// (emailDispatchShell.js, subscriberPage.js, auth.js). Now validated:
// hex colors against a #rrggbb pattern (matching the native color-picker
// inputs that are the only legitimate source), brandFont against an
// explicit allowlist (frontend/src/pages/AdminSettingsAbout.jsx's
// FONT_OPTIONS -- there's no native input to constrain free text the way
// the color pickers do).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");

let admin;
let originalSettings;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  originalSettings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
});

after(async () => {
  if (originalSettings) {
    await prisma.churchSettings
      .update({ where: { id: "singleton" }, data: originalSettings })
      .catch(() => {});
  }
  await removeTestUsers();
  await stopServer();
});

describe("PUT /api/settings -- brand color/font validation (#327 Finding 11.4)", () => {
  test("a valid #rrggbb hex color is accepted", async () => {
    const res = await admin("/api/settings", {
      method: "PUT",
      body: { primaryColor: "#2a5d3c", headerColor: "#2c2a28", highlightColor: "#a6540f" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.primaryColor, "#2a5d3c");
  });

  test("an empty string clears a color back to the default", async () => {
    const res = await admin("/api/settings", { method: "PUT", body: { primaryColor: "" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.primaryColor, "");
  });

  test("a non-hex color string is rejected with a 400, not stored", async () => {
    const res = await admin("/api/settings", {
      method: "PUT",
      body: { primaryColor: 'red" onmouseover="alert(1)' },
    });
    assert.equal(res.status, 400);
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { primaryColor: true },
    });
    assert.notEqual(row.primaryColor, 'red" onmouseover="alert(1)');
  });

  test("a too-short/too-long hex color is rejected", async () => {
    assert.equal(
      (await admin("/api/settings", { method: "PUT", body: { headerColor: "#fff" } })).status,
      400
    );
    assert.equal(
      (await admin("/api/settings", { method: "PUT", body: { headerColor: "#aabbccdd" } })).status,
      400
    );
  });

  test("one of the allowlisted font stacks is accepted", async () => {
    const res = await admin("/api/settings", {
      method: "PUT",
      body: { brandFont: '"Helvetica Neue", Arial, sans-serif' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.brandFont, '"Helvetica Neue", Arial, sans-serif');
  });

  test("an empty string clears brandFont back to the system default", async () => {
    const res = await admin("/api/settings", { method: "PUT", body: { brandFont: "" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.brandFont, "");
  });

  test("an arbitrary font string outside the allowlist is rejected, not stored", async () => {
    const malicious = '"></style><script>alert(1)</script>';
    const res = await admin("/api/settings", { method: "PUT", body: { brandFont: malicious } });
    assert.equal(res.status, 400);
    const row = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { brandFont: true },
    });
    assert.notEqual(row.brandFont, malicious);
  });
});
