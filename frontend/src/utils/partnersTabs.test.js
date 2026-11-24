import { describe, it, expect } from "vitest";
import { partnersTabState } from "./partnersTabs.js";

const base = { hasAssignedTab: true, assignedParam: null, reachableIds: ["a", "b"], seatIds: ["a", "b"] };

describe("partnersTabState", () => {
  it("shows no tabs to someone with no care team seat", () => {
    expect(partnersTabState({ ...base, hasAssignedTab: false, isGuest: false })).toEqual({
      showAssigned: false,
      showTabs: false,
    });
  });

  it("lands staff on All, with My partners one click away", () => {
    expect(partnersTabState({ ...base, isGuest: false })).toEqual({ showAssigned: false, showTabs: true });
    expect(partnersTabState({ ...base, isGuest: false, assignedParam: "1" })).toEqual({
      showAssigned: true,
      showTabs: true,
    });
  });

  it("lands a care team guest on My partners and hides All when it adds nothing", () => {
    expect(partnersTabState({ ...base, isGuest: true })).toEqual({ showAssigned: true, showTabs: false });
    // even if they ask for All by URL: it would be the same list
    expect(partnersTabState({ ...base, isGuest: true, assignedParam: "0" })).toEqual({
      showAssigned: true,
      showTabs: false,
    });
  });

  it("keeps both tabs for a guest who can also see a partner they are not on the team for", () => {
    const extra = { ...base, isGuest: true, reachableIds: ["a", "b", "trip-partner"] };
    expect(partnersTabState(extra)).toEqual({ showAssigned: true, showTabs: true });
    expect(partnersTabState({ ...extra, assignedParam: "0" })).toEqual({
      showAssigned: false,
      showTabs: true,
    });
  });

  it("does not hide All for a guest until the reachable partners have loaded", () => {
    expect(partnersTabState({ ...base, isGuest: true, reachableIds: [] })).toEqual({
      showAssigned: true,
      showTabs: true,
    });
  });
});
