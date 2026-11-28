import { describe, it, expect } from "vitest";
import { formatChurchDateTime, toChurchDateTimeInputValue, churchZoneName } from "./churchTime.js";

// 6:00 PM in Chicago on 1 December 2026 (winter, UTC-6).
const SIX_PM_CENTRAL = "2026-12-02T00:00:00.000Z";

describe("church time", () => {
  it("shows the church's hour and names the zone, whatever zone the browser is in", () => {
    const shown = formatChurchDateTime(SIX_PM_CENTRAL, "America/Chicago");
    expect(shown).toMatch(/Dec 1, 2026/);
    expect(shown).toMatch(/6:00\sPM/);
    expect(shown).toMatch(/Central Time$/);
  });

  it("prefills an edit box with the church's wall-clock time, not the UTC string", () => {
    expect(toChurchDateTimeInputValue(SIX_PM_CENTRAL, "America/Chicago")).toBe("2026-12-01T18:00");
    expect(toChurchDateTimeInputValue(SIX_PM_CENTRAL, "Africa/Nairobi")).toBe("2026-12-02T03:00");
    expect(toChurchDateTimeInputValue("2026-12-01T06:30:00.000Z", "America/Chicago")).toBe(
      "2026-12-01T00:30"
    );
  });

  it("follows daylight saving in the church's zone", () => {
    expect(toChurchDateTimeInputValue("2026-07-01T23:00:00.000Z", "America/Chicago")).toBe(
      "2026-07-01T18:00"
    );
  });

  it("copes with nothing to show and with an unknown zone", () => {
    expect(formatChurchDateTime(null, "America/Chicago", { fallback: "—" })).toBe("—");
    expect(toChurchDateTimeInputValue("", "America/Chicago")).toBe("");
    expect(toChurchDateTimeInputValue(SIX_PM_CENTRAL, "Not/AZone")).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
    );
    expect(churchZoneName("Africa/Nairobi")).toBe("East Africa Time");
  });
});
