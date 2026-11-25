import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSettingsCareTeam from "./AdminSettingsCareTeam.jsx";
import {
  fetchDefaultCareLead,
  setDefaultCareLead,
  fetchCareTeamCandidates,
  fetchChurchSettings,
  updateChurchSettings,
} from "../api/client.js";

// The default lead: who key-date reminders go to for a partner with no care team. Admin only
// (the route is admin-gated).
vi.mock("../api/client.js", () => ({
  fetchDefaultCareLead: vi.fn(),
  setDefaultCareLead: vi.fn(),
  fetchCareTeamCandidates: vi.fn(),
  fetchChurchSettings: vi.fn(),
  updateChurchSettings: vi.fn(),
}));
let features = { careTeam: true, keyDates: true, outboundEmail: true };
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: features }),
}));

const candidates = [
  { id: "u1", email: "ann@example.test", firstName: "Ann", lastName: "Lead", role: "editor" },
  { id: "u2", email: "bob@example.test", firstName: "Bob", lastName: "Member", role: "guest" },
];

const renderIt = () =>
  render(
    <MemoryRouter>
      <AdminSettingsCareTeam />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  features = { careTeam: true, keyDates: true, outboundEmail: true };
  fetchDefaultCareLead.mockResolvedValue(null);
  setDefaultCareLead.mockResolvedValue({ userId: "u1", name: "Ann Lead" });
  fetchCareTeamCandidates.mockResolvedValue(candidates);
  fetchChurchSettings.mockResolvedValue({ keyDateLeadDays: 7, contactStaleDays: 90 });
  updateChurchSettings.mockResolvedValue({});
});

describe("AdminSettingsCareTeam (#291)", () => {
  it("shows no default lead yet, and explains what one is for", async () => {
    renderIt();
    expect(await screen.findByText("None")).toBeTruthy();
    expect(screen.getByText(/go to the default lead instead of nobody/)).toBeTruthy();
  });

  it("shows the current default lead", async () => {
    fetchDefaultCareLead.mockResolvedValue({ userId: "u1", name: "Ann Lead" });
    renderIt();
    expect(await screen.findByText("Ann Lead")).toBeTruthy();
  });

  it("picks a default lead from the logins and saves it", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /default lead/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Default lead"), { target: { value: "u1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(setDefaultCareLead).toHaveBeenCalledWith("u1"));
  });

  it("clearing it sends null", async () => {
    fetchDefaultCareLead.mockResolvedValue({ userId: "u1", name: "Ann Lead" });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /default lead/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Default lead"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(setDefaultCareLead).toHaveBeenCalledWith(null));
  });

  it("reports the state of key-date reminders", async () => {
    renderIt();
    expect(await screen.findByText(/one grouped email a day/)).toBeTruthy();
    features = { careTeam: true, keyDates: true, outboundEmail: false };
    renderIt();
    expect((await screen.findAllByText(/Turn on Email \(Sending\)/)).length).toBe(1);
    features = { careTeam: true, keyDates: false };
    renderIt();
    expect((await screen.findAllByText(/Key-date reminders/)).length).toBeGreaterThan(0);
  });

  it("shows the key-date lead time and the quiet threshold, from the church's settings (#365)", async () => {
    fetchChurchSettings.mockResolvedValue({ keyDateLeadDays: 10, contactStaleDays: 45 });
    renderIt();
    expect(await screen.findByText("10 days ahead")).toBeTruthy();
    expect(screen.getByText("45 days without contact")).toBeTruthy();
  });

  it("saves new timings as numbers", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /timing/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Raise a key date/), { target: { value: "14" } });
    fireEvent.change(within(dialog).getByLabelText(/Call a partner quiet/), { target: { value: "60" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateChurchSettings).toHaveBeenCalledWith({ keyDateLeadDays: 14, contactStaleDays: 60 })
    );
  });
});
