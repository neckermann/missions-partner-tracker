import { describe, it, expect } from "vitest";
import { publicSiteOn } from "./publicSite.js";

describe("publicSiteOn", () => {
  it("is off when nothing public is on, however the settings arrive", () => {
    expect(publicSiteOn({})).toBe(false);
    expect(publicSiteOn(undefined)).toBe(false);
    expect(publicSiteOn({ booklet: true, trips: true })).toBe(false);
  });
  it("is on for the directory, the map or the prayer sign-up", () => {
    for (const k of ["publicDirectory", "publicMap", "publicPrayerDigest"]) {
      expect(publicSiteOn({ [k]: true })).toBe(true);
    }
  });
});
