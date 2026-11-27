import { describe, it, expect } from "vitest";
import { formatPhone } from "./phone.js";

describe("formatPhone", () => {
  it("shows a North American number the way it is usually written", () => {
    expect(formatPhone("+15065550259")).toBe("(506) 555-0259");
    expect(formatPhone("5065550259")).toBe("(506) 555-0259");
    expect(formatPhone("(506) 555-0259")).toBe("(506) 555-0259");
  });

  it("shows any other country with its country code", () => {
    expect(formatPhone("+442079460958")).toBe("+44 20 7946 0958");
    expect(formatPhone("+33123456789")).toBe("+33 1 23 45 67 89");
  });

  it("shows a fictional 555 number rather than hiding it", () => {
    expect(formatPhone("+15551234567")).toBe("(555) 123-4567");
  });

  it("returns what it was given when it is not a number, and blank for blank", () => {
    expect(formatPhone("dsafdsfsadf")).toBe("dsafdsfsadf");
    expect(formatPhone("12345")).toBe("12345");
    expect(formatPhone("")).toBe("");
    expect(formatPhone("   ")).toBe("");
    expect(formatPhone(null)).toBe("");
    expect(formatPhone(undefined)).toBe("");
  });
});
