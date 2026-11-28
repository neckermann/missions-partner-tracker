import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminHome from "./AdminHome.jsx";

let current;
let features;
vi.mock("../hooks/useCurrentUser.js", () => ({ default: () => current }));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    partnerTermPlural: "Partners",
    usePartnerTermInAdmin: false,
    enabledFeatures: features,
    ownerGroupName: "Missions team",
  }),
}));
vi.mock("../hooks/useNotifications.js", () => ({ default: () => ({ categories: [] }) }));
vi.mock("../hooks/usePublicSiteChoiceRedirect.js", () => ({ default: () => {} }));
vi.mock("../hooks/useRecentlyViewed.js", () => ({ getRecentlyViewed: () => [] }));
vi.mock("../api/client.js", () => ({ fetchPartners: vi.fn().mockResolvedValue([]) }));

const show = () =>
  render(
    <MemoryRouter>
      <AdminHome />
    </MemoryRouter>
  );

beforeEach(() => {
  features = { contactLog: true, keyDates: true };
  current = { user: { firstName: "Sam" }, isAdmin: true, onMissionsTeam: false, careTeamSeats: [] };
});

describe("the Home line for an admin who is sent no partner reminders", () => {
  it("explains why, with a link to choose the team", () => {
    show();
    expect(screen.getByTestId("no-care-items-note").textContent).toMatch(/aren't on the Missions team/);
    expect(
      screen.getByRole("link", { name: /choose who is on the Missions team/ }).getAttribute("href")
    ).toBe("/admin/settings/partner-care");
  });

  it("is not shown to an admin on the team, one with a care seat, or when no reminder feature is on", () => {
    current = { ...current, onMissionsTeam: true };
    show();
    expect(screen.queryByTestId("no-care-items-note")).toBeNull();
  });
  it("is not shown with a care team seat", () => {
    current = { ...current, careTeamSeats: [{ id: "p1" }] };
    show();
    expect(screen.queryByTestId("no-care-items-note")).toBeNull();
  });
  it("is not shown when contact log and key dates are both off", () => {
    features = {};
    show();
    expect(screen.queryByTestId("no-care-items-note")).toBeNull();
  });
  it("is not shown to someone who is not an admin", () => {
    current = { ...current, isAdmin: false };
    show();
    expect(screen.queryByTestId("no-care-items-note")).toBeNull();
  });
});
