import { describe, it, expect } from "vitest";
import { supportNeedStatus } from "./supportNeedStatus.js";

const need = (over) => ({
  requestedAmount: 500,
  approvedAmount: null,
  handledBy: null,
  metDate: null,
  ...over,
});

describe("supportNeedStatus", () => {
  it("reads Pending Decision when nothing has happened", () => {
    expect(supportNeedStatus(need()).label).toBe("Pending Decision");
  });

  it("says someone's on it, and who, while it is undecided", () => {
    expect(supportNeedStatus(need({ handledBy: "the deacons" })).label).toBe("Someone's on it: the deacons");
  });

  it("keeps the funding decision once there is one, even with someone on it", () => {
    expect(supportNeedStatus(need({ handledBy: "the deacons", approvedAmount: 500 })).label).toBe(
      "Fully Funded"
    );
    expect(supportNeedStatus(need({ handledBy: "x", approvedAmount: 0 })).label).toBe("Declined");
  });

  it("says Met whatever was decided or who is on it", () => {
    expect(supportNeedStatus(need({ metDate: "2026-11-01" })).label).toBe("Met");
    expect(supportNeedStatus(need({ metDate: "2026-11-01", approvedAmount: 0 })).label).toBe("Met");
    expect(supportNeedStatus(need({ metDate: "2026-11-01", handledBy: "x" })).label).toBe("Met");
  });
});
