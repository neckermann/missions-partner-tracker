import { describe, it, expect } from "vitest";
import { addressToValue, formatAddressValue, parseAddressValue } from "./address.js";

describe("survey mailing address", () => {
  it("keeps only what was filled in, trimmed, in one JSON line", () => {
    expect(addressToValue({ line1: " 12 Main St ", city: "Lafayette", line2: "  " })).toBe(
      JSON.stringify({ line1: "12 Main St", city: "Lafayette" })
    );
    expect(addressToValue({ line1: " " })).toBe("");
  });

  it("reads one back, and a broken value as empty", () => {
    expect(parseAddressValue('{"city":"Lafayette"}')).toEqual({ city: "Lafayette" });
    expect(parseAddressValue("nope")).toEqual({});
    expect(parseAddressValue("")).toEqual({});
  });

  it("writes it as one readable line", () => {
    const v = addressToValue({
      line1: "12 Main St",
      line2: "Apt 2",
      city: "Lafayette",
      region: "LA",
      postal: "70501",
      country: "USA",
    });
    expect(formatAddressValue(v)).toBe("12 Main St, Apt 2, Lafayette, LA 70501, USA");
    expect(formatAddressValue("")).toBe("");
  });
});
