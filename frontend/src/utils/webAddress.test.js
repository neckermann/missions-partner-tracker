import { describe, it, expect } from "vitest";
import { normalizeWebAddress, webAddressHint, streetHint } from "./webAddress.js";

describe("web address rule (mirrors the server)", () => {
  it("accepts http(s) and a bare address, which is saved with https://", () => {
    expect(normalizeWebAddress("https://example.org/give")).toBe("https://example.org/give");
    expect(normalizeWebAddress("example.org/give")).toBe("https://example.org/give");
    expect(normalizeWebAddress("  //example.org ")).toBe("https://example.org");
    expect(normalizeWebAddress("example.org:8080/x")).toBe("https://example.org:8080/x");
  });
  it("refuses other schemes, spaces and one-word hosts", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://example.org",
      "exa mple.org",
      "hello",
    ]) {
      expect(normalizeWebAddress(bad)).toBeUndefined();
    }
  });
  it("gives a hint only for something that cannot be saved; blank is fine", () => {
    expect(webAddressHint("")).toBe("");
    expect(webAddressHint("example.org")).toBe("");
    expect(webAddressHint("javascript:alert(1)")).toMatch(/web address/);
  });
});

describe("street address hint", () => {
  it("is quiet for a number or a PO box, or an empty line", () => {
    for (const ok of ["", "123 Main St", "PO Box 45", "P.O. Box 7", "Box 12", "Apartado 5"]) {
      expect(streetHint(ok)).toBe("");
    }
  });
  it("speaks up when there is neither a number nor a box", () => {
    expect(streetHint("Main Street")).toMatch(/street address or a PO box/);
  });
});
