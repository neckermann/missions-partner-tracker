const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { silhouetteFor, NEUTRAL_ACCENT } = require("../src/utils/silhouette");

describe("silhouetteFor", () => {
  test("returns a valid SVG data URI for each known category", () => {
    for (const category of ["single", "couple", "family", "organization"]) {
      const uri = silhouetteFor(category);
      assert.equal(uri.startsWith("data:image/svg+xml,"), true);
      assert.equal(decodeURIComponent(uri.slice("data:image/svg+xml,".length)).includes("<svg"), true);
    }
  });

  test("each category produces a visually distinct shape", () => {
    const shapes = ["single", "couple", "family", "organization"].map((c) => silhouetteFor(c));
    assert.equal(new Set(shapes).size, shapes.length);
  });

  test("uses the fixed neutral accent color by default", () => {
    assert.equal(silhouetteFor("single").includes(encodeURIComponent(NEUTRAL_ACCENT)), true);
  });

  test("accepts a custom background color", () => {
    const uri = silhouetteFor("single", "#ff0000");
    assert.equal(uri.includes(encodeURIComponent("#ff0000")), true);
  });

  test("falls back to the single-person shape for an unknown category", () => {
    assert.equal(silhouetteFor("unknown-category"), silhouetteFor("single"));
  });
});
