import { describe, test, expect } from "vitest";
import {
  TEMPLATES,
  TEMPLATE_OPTIONS,
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  resolveAccent,
  templateWrapperMarkup,
} from "./templates.js";

// #322: the booklet template picker is now driven entirely by this
// catalog instead of a literal array in AdminBooklet.jsx -- these pin the
// catalog's v1 shape (exactly Classic + Modern) and the accent-resolution
// rule (ChurchSettings.primaryColor as the default, the fixed rotation
// only as an unconfigured-instance fallback) so a future change to either
// has to be deliberate.

describe("TEMPLATE_OPTIONS", () => {
  test("offers exactly Classic and Modern, in that order", () => {
    expect(TEMPLATE_OPTIONS.map((t) => t.value)).toEqual(["classic", "modern"]);
    expect(TEMPLATE_OPTIONS.every((t) => t.label && t.description)).toBe(true);
  });

  test("TEMPLATES carries no deferred template (Traditional/Keepsake/Portfolio/Friendly)", () => {
    expect(TEMPLATES).toHaveLength(2);
    const ids = TEMPLATES.map((t) => t.id);
    for (const deferred of ["traditional", "keepsake", "portfolio", "friendly"]) {
      expect(ids).not.toContain(deferred);
    }
  });
});

describe("getTemplate", () => {
  test("resolves a known id", () => {
    expect(getTemplate("modern").id).toBe("modern");
  });

  test("falls back to the default template for an unknown id", () => {
    expect(getTemplate("nonexistent").id).toBe(DEFAULT_TEMPLATE_ID);
  });
});

describe("resolveAccent", () => {
  const classic = getTemplate("classic");

  test("resolves to ChurchSettings.primaryColor when the church has set one", () => {
    expect(resolveAccent(classic, "#112233", 0)).toBe("#112233");
    // Same brand color regardless of the rotation index -- a "brand"
    // accentSource template doesn't vary accent per entry once a real
    // brand color exists.
    expect(resolveAccent(classic, "#112233", 3)).toBe("#112233");
  });

  test("falls back to the fixed rotation when no primaryColor is configured", () => {
    const first = resolveAccent(classic, null, 0);
    const second = resolveAccent(classic, null, 1);
    expect(first).toMatch(/^#[0-9A-F]{6}$/i);
    expect(second).toMatch(/^#[0-9A-F]{6}$/i);
    expect(first).not.toBe(second);
  });

  test("also falls back for an empty-string primaryColor (falsy, not just null/undefined)", () => {
    expect(resolveAccent(classic, "", 0)).not.toBe("");
  });

  test("rotation wraps around rather than running out", () => {
    expect(resolveAccent(classic, null, 0)).toBe(resolveAccent(classic, null, 4));
  });
});

describe("templateWrapperMarkup", () => {
  test("escapes an embedded double quote in a token value (fontFamily) so it can't break out of the style attribute", () => {
    const classic = getTemplate("classic");
    const { styleString } = templateWrapperMarkup(classic);
    expect(classic.tokens.fontFamily).toContain('"');
    expect(styleString).not.toContain('"');
    expect(styleString).toContain("&quot;");
  });

  test("carries each template's structural data-* attributes", () => {
    const modern = getTemplate("modern");
    const { attrString } = templateWrapperMarkup(modern);
    expect(attrString).toContain('data-template="modern"');
    expect(attrString).toContain('data-shape-style="none"');
    expect(attrString).toContain('data-photo-shape="rect"');
  });
});
