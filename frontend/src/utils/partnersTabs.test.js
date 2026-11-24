import { describe, it, expect } from "vitest";
import { partnersTabState } from "./partnersTabs.js";

const base = { hasAssignedTab: true, assignedParam: null };

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

  it("gives a care team guest My partners alone, whatever the URL asks for", () => {
    expect(partnersTabState({ ...base, isGuest: true })).toEqual({ showAssigned: true, showTabs: false });
    expect(partnersTabState({ ...base, isGuest: true, assignedParam: "0" })).toEqual({
      showAssigned: true,
      showTabs: false,
    });
  });
});
