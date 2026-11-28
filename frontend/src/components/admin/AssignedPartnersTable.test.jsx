import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AssignedPartnersTable from "./AssignedPartnersTable.jsx";
import { fetchAssignedPartners, createContactLogEntry, fetchMyKeyDates } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({
  fetchAssignedPartners: vi.fn(),
  createContactLogEntry: vi.fn(),
  fetchMyKeyDates: vi.fn(),
}));
let features = { prayerRequests: true, oneTimeNeeds: false };
vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: features, churchName: "Hillside" }),
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

beforeEach(() => {
  features = { prayerRequests: true, oneTimeNeeds: false };
  fetchAssignedPartners.mockResolvedValue(rows);
});

const renderIt = () =>
  render(
    <MemoryRouter>
      <AssignedPartnersTable />
    </MemoryRouter>
  );

describe("the key-date list you can copy when email is off", () => {
  const items = [
    { partnerId: "p1", when: "In 2 days · Sat Nov 28", text: "The Reeds: Dana's birthday (turning 40)" },
  ];

  it("shows what the email would have said, with a copy button, only when email is off", async () => {
    features = { keyDates: true, outboundEmail: false };
    fetchMyKeyDates.mockResolvedValue({ emailOn: false, items });
    renderIt();
    expect(await screen.findByText(/Key-date emails aren.t on here/)).toBeTruthy();
    expect(screen.getByText(/Dana's birthday/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy this week's list/ })).toBeTruthy();
  });

  it("is not shown when email is on, or when nothing is coming up", async () => {
    features = { keyDates: true, outboundEmail: true };
    renderIt();
    await screen.findByText("The Reeds");
    expect(fetchMyKeyDates).not.toHaveBeenCalled();
    expect(screen.queryByText(/Key-date emails aren.t on here/)).toBeNull();

    features = { keyDates: true, outboundEmail: false };
    fetchMyKeyDates.mockResolvedValue({ emailOn: false, items: [] });
    renderIt();
    await waitFor(() => expect(fetchMyKeyDates).toHaveBeenCalled());
    expect(screen.queryByText(/Key-date emails aren.t on here/)).toBeNull();
  });
});

describe("AssignedPartnersTable (#288)", () => {
  it("shows the care columns, with quiet and due flagged", async () => {
    features = { ...features, keyDates: true };
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

  it("has no key-date column, and offers no greeting, while key dates is off", async () => {
    fetchAssignedPartners.mockResolvedValue([
      {
        ...rows[0],
        nextKeyDate: { ...rows[0].nextKeyDate, daysUntil: 2 },
        greetingEmail: "dana@example.org",
      },
    ]);
    renderIt();
    await screen.findByText("The Reeds");
    expect(screen.queryByText("Next key date")).toBeNull();
    expect(screen.queryByText(/Birthday \(Dana\)/)).toBeNull();
    expect(screen.queryByText("Send greeting")).toBeNull();
  });

  it("says so when you aren't on any care team", async () => {
    fetchAssignedPartners.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText(/aren't on any partner's care team/)).toBeTruthy();
  });
});

// A key date inside the reminder window is flagged, only with the feature on.
describe("AssignedPartnersTable: key-date flag (#291)", () => {
  const soon = (daysUntil) => [{ ...rows[0], nextKeyDate: { ...rows[0].nextKeyDate, daysUntil } }];

  it("flags a key date within 7 days, and says Today for today", async () => {
    features = { keyDates: true };
    fetchAssignedPartners.mockResolvedValue(soon(3));
    renderIt();
    expect(await screen.findByText("Soon")).toBeTruthy();
    fetchAssignedPartners.mockResolvedValue(soon(0));
    renderIt();
    expect(await screen.findByText("Today")).toBeTruthy();
  });

  it("doesn't flag one that is further off, or when the feature is off", async () => {
    features = { keyDates: true };
    fetchAssignedPartners.mockResolvedValue(soon(8));
    renderIt();
    await screen.findByText("The Reeds");
    expect(screen.queryByText("Soon")).toBeNull();

    features = { keyDates: false };
    fetchAssignedPartners.mockResolvedValue(soon(2));
    renderIt();
    await waitFor(() => expect(screen.getAllByText("The Reeds").length).toBe(2));
    expect(screen.queryByText("Soon")).toBeNull();
  });

  it("offers a greeting draft only where we may email, and logs it as a Key date contact once sent", async () => {
    features = { ...features, contactLog: true, keyDates: true };
    fetchAssignedPartners.mockResolvedValue([
      {
        ...rows[0],
        nextKeyDate: { ...rows[0].nextKeyDate, daysUntil: 3 },
        greetingEmail: "dana@example.org",
      },
      {
        ...rows[1],
        nextKeyDate: { date: "2026-11-28", daysUntil: 3, occasion: "Birthday", who: "Sam" },
        greetingEmail: null,
      },
    ]);
    createContactLogEntry.mockResolvedValue({});
    const hrefSet = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        set href(v) {
          hrefSet(v);
        },
      },
    });
    renderIt();
    const buttons = await screen.findAllByRole("button", { name: "Send greeting" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(hrefSet).toHaveBeenCalledWith(
      expect.stringMatching(/^mailto:dana@example\.org\?subject=Happy%20birthday/)
    );
    fireEvent.click(await screen.findByRole("button", { name: "Yes, log it" }));
    await waitFor(() => expect(createContactLogEntry).toHaveBeenCalled());
    expect(createContactLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: "p1",
        contactType: "email",
        direction: "outbound",
        topics: ["keydate"],
      })
    );
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
