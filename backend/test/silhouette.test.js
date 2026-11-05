const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { silhouetteFor, silhouetteMarkup, NEUTRAL_ACCENT } = require("../src/utils/silhouette");

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

describe("silhouetteMarkup", () => {
  // The raw-SVG counterpart to silhouetteFor()'s data: URI -- routes/
  // silhouette.js serves this directly, since an email client won't
  // reliably render a data: URI in an <img src>.
  test("returns raw SVG markup, not a data URI", () => {
    const markup = silhouetteMarkup("single");
    assert.equal(markup.startsWith("<svg"), true);
    assert.equal(silhouetteFor("single"), `data:image/svg+xml,${encodeURIComponent(markup)}`);
  });
});
