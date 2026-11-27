import { describe, it, expect } from "vitest";
import { PHONE_COUNTRIES, phoneCountryLabel } from "./phoneCountries.js";

describe("PHONE_COUNTRIES", () => {
  it("lists the countries with their calling codes, sorted by name", () => {
    const labels = PHONE_COUNTRIES.map((c) => c.label);
    expect(labels).toContain("United States (+1)");
    expect(labels).toContain("United Kingdom (+44)");
    expect(labels).toContain("Kenya (+254)");
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(PHONE_COUNTRIES.length).toBeGreaterThan(200);
  });

  it("has one entry per two-letter code", () => {
    const codes = PHONE_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("names a code, and falls back to the code or nothing", () => {
    expect(phoneCountryLabel("GB")).toBe("United Kingdom (+44)");
    expect(phoneCountryLabel("ZZ")).toBe("ZZ");
    expect(phoneCountryLabel("")).toBe("");
    expect(phoneCountryLabel(undefined)).toBe("");
  });
});
