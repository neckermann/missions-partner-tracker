import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AssignedPartnersTable from "./AssignedPartnersTable.jsx";
import { fetchAssignedPartners } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({ fetchAssignedPartners: vi.fn() }));
vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: { prayerRequests: true, oneTimeNeeds: false } }),
}));

const rows = [
  {
    partnerId: "p1",
    displayName: "The Reeds",
    isLead: true,
    daysSinceContact: 120,
    quiet: true,
    followUpDate: "2026-11-01",
    followUpDue: true,
    nextKeyDate: { date: "2026-12-05", daysUntil: 11, occasion: "Birthday", who: "Dana" },
    openPrayers: 2,
    openNeeds: 1,
  },
  {
    partnerId: "p2",
    displayName: "The Okafors",
    isLead: false,
    daysSinceContact: null,
    quiet: true,
    followUpDate: null,
    followUpDue: false,
    nextKeyDate: null,
    openPrayers: 0,
    openNeeds: 0,
  },
];

beforeEach(() => fetchAssignedPartners.mockResolvedValue(rows));

const renderIt = () =>
  render(
    <MemoryRouter>
      <AssignedPartnersTable />
    </MemoryRouter>
  );

describe("AssignedPartnersTable (#288)", () => {
  it("shows the care columns, with quiet and due flagged", async () => {
    renderIt();
    expect(await screen.findByText("The Reeds")).toBeTruthy();
    expect(screen.getByText("120 days ago")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.getAllByText("Quiet").length).toBe(2);
    expect(screen.getByText("Due")).toBeTruthy();
    expect(screen.getByText(/Birthday \(Dana\)/)).toBeTruthy();
    expect(screen.getByText("Lead")).toBeTruthy();
  });

  it("only shows the prayer and needs columns for features that are on", async () => {
    renderIt();
    await screen.findByText("The Reeds");
    expect(screen.getByText("Open prayers")).toBeTruthy();
    expect(screen.queryByText("Open needs")).toBeNull();
  });

  it("says so when you aren't on any care team", async () => {
    fetchAssignedPartners.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText(/aren't on any partner's care team/)).toBeTruthy();
  });
});
