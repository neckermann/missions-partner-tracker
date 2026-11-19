import { describe, test, expect } from "vitest";
import { mapServerErrorMessage } from "./friendlyError.js";

describe("mapServerErrorMessage", () => {
  test("maps a missing required field", () => {
    expect(mapServerErrorMessage("displayName: Invalid input: expected string, received undefined")).toBe(
      "displayName is required"
    );
  });

  test("maps an invalid email", () => {
    expect(mapServerErrorMessage("email: Invalid email address")).toBe("email must be a valid email address");
  });

  test("maps a too-short string", () => {
    expect(mapServerErrorMessage("notes: Too small: expected string to have >=3 characters")).toBe(
      "notes must be at least 3 characters"
    );
  });

  test("preserves the (+N more) suffix", () => {
    expect(
      mapServerErrorMessage("a: Invalid email address; b: Invalid URL (+2 more)")
    ).toBe("a must be a valid email address; b must be a valid web address (+2 more)");
  });

  test("returns an unrecognized message unchanged", () => {
    expect(mapServerErrorMessage("Server error")).toBe("Server error");
  });

  test("returns a plain path:message pair unchanged if no pattern matches", () => {
    expect(mapServerErrorMessage("name: Something unexpected happened")).toBe(
      "name: Something unexpected happened"
    );
  });

  test("passes through non-string input", () => {
    expect(mapServerErrorMessage(null)).toBe(null);
    expect(mapServerErrorMessage(undefined)).toBe(undefined);
  });
});
