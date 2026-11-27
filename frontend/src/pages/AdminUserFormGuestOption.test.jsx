import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUserForm from "./AdminUserForm.jsx";

// The Guest role is offered only when it can be used: a guest reaches the app through a trip or a care
// team seat, so with neither feature on it would be a login that sees nothing. The wording says what the
// features allow, not "trips only".
let features;
vi.mock("../api/client.js", () => ({
  createUser: vi.fn(),
  fetchCurrentUser: vi.fn().mockResolvedValue({ id: "a", role: "admin", emailReady: true }),
  fetchTrips: vi.fn().mockResolvedValue([]),
  fetchReachablePartners: vi.fn().mockResolvedValue([]),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: features }),
}));

function roleOptions() {
  render(
    <MemoryRouter initialEntries={["/admin/settings/users/new"]}>
      <AdminUserForm />
    </MemoryRouter>
  );
  return [...screen.getByLabelText("Role").querySelectorAll("option")].map((o) => o.textContent);
}

describe("Add User: the Guest role", () => {
  it("is not offered when neither trips nor care teams are on", () => {
    features = {};
    expect(roleOptions().some((t) => /Guest/.test(t))).toBe(false);
  });

  it("says trips when only trips are on", () => {
    features = { trips: true };
    expect(roleOptions()).toContain("Guest (only the trips you choose)");
  });

  it("says partners when only care teams are on, and both when both are", () => {
    features = { careTeam: true };
    expect(roleOptions()).toContain("Guest (only the partners you choose)");
  });

  it("names both when both are on", () => {
    features = { trips: true, careTeam: true };
    expect(roleOptions()).toContain("Guest (only the trips and the partners you choose)");
  });
});
