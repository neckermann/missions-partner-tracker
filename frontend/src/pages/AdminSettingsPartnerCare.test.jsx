import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSettingsPartnerCare from "./AdminSettingsPartnerCare.jsx";
import {
  fetchMissionsTeam,
  saveMissionsTeam,
  fetchChurchSettings,
  updateChurchSettings,
} from "../api/client.js";

// The missions team: who looks after partners with no care team of their own, named however the church says
// it. Admin only (the route is admin-gated).
vi.mock("../api/client.js", () => ({
  fetchMissionsTeam: vi.fn(),
  saveMissionsTeam: vi.fn(),
  fetchChurchSettings: vi.fn(),
  updateChurchSettings: vi.fn(),
}));
let features = { careTeam: true, keyDates: true, outboundEmail: true };
let groupName = "Missions team";
const tiers = { biweekly: false, monthly: true, quarterly: true };
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    enabledFeatures: features,
    ownerGroupName: groupName,
    refreshSettings: vi.fn(),
    cadenceTiersEnabled: tiers,
  }),
}));

const candidates = [
  { id: "u1", name: "Ann Lead", email: "ann@example.test", role: "editor" },
  { id: "u2", name: "Bob Member", email: "bob@example.test", role: "viewer" },
];

const renderIt = () =>
  render(
    <MemoryRouter>
      <AdminSettingsPartnerCare />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  features = { careTeam: true, keyDates: true, outboundEmail: true };
  fetchMissionsTeam.mockResolvedValue({ members: [], candidates });
  saveMissionsTeam.mockResolvedValue([]);
  fetchChurchSettings.mockResolvedValue({ keyDateLeadDays: 7, contactStaleDays: 90 });
  updateChurchSettings.mockResolvedValue({});
});

describe("AdminSettingsPartnerCare", () => {
  it("warns when nobody is on the missions team, and explains what it does", async () => {
    renderIt();
    expect(await screen.findByText(/Nobody is on the Missions team/)).toBeTruthy();
    expect(screen.getByText(/looks after every partner that doesn.t have a care team/)).toBeTruthy();
  });

  it("shows who is on it", async () => {
    fetchMissionsTeam.mockResolvedValue({ members: [{ id: "u1", name: "Ann Lead" }], candidates });
    renderIt();
    expect(await screen.findByText("Ann Lead")).toBeTruthy();
    expect(screen.queryByText(/Nobody is on the Missions team/)).toBeNull();
  });

  it("uses the church's own name for the group", async () => {
    groupName = "Missions committee";
    renderIt();
    expect(await screen.findByText(/Nobody is on the Missions committee/)).toBeTruthy();
    groupName = "Missions team";
  });

  it("picks members and a name, then saves both", async () => {
    renderIt();
    fireEvent.click((await screen.findAllByRole("button", { name: /missions team/i }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByLabelText(/Ann Lead/));
    fireEvent.change(within(dialog).getByLabelText(/What do you call this group/), {
      target: { value: "Missions committee" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveMissionsTeam).toHaveBeenCalledWith(["u1"]));
    expect(updateChurchSettings).toHaveBeenCalledWith({ ownerGroupName: "Missions committee" });
  });

  it("clearing the name goes back to the default wording", async () => {
    fetchMissionsTeam.mockResolvedValue({ members: [{ id: "u1", name: "Ann Lead" }], candidates });
    renderIt();
    fireEvent.click((await screen.findAllByRole("button", { name: /missions team/i }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/What do you call this group/), {
      target: { value: "" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateChurchSettings).toHaveBeenCalledWith({ ownerGroupName: null }));
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
    expect(screen.getByText("90 days, 30 days ahead")).toBeTruthy();
  });

  it("the key-date numbers are their own editable card under the reminder status, saved as numbers", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /key-date timing/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Raise a key date/), { target: { value: "14" } });
    fireEvent.change(within(dialog).getByLabelText(/Earlier heads-ups/), { target: { value: "120, 45 x" } });
    // The quiet-partner number is not on this card.
    expect(within(dialog).queryByLabelText(/Call a partner quiet/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateChurchSettings).toHaveBeenCalledWith({
        keyDateLeadDays: 14,
        keyDateAdvanceDays: [120, 45],
      })
    );
  });

  it("the quiet-partner number is on its own card, and saves only itself", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /quiet partners/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Raise a key date/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Call a partner quiet/), { target: { value: "60" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateChurchSettings).toHaveBeenCalledWith({ contactStaleDays: 60 }));
  });

  it("the key-date status links to Enabled Features for the on/off switch", async () => {
    renderIt();
    const link = await screen.findByRole("link", { name: "Enabled Features" });
    expect(link.getAttribute("href")).toBe("/admin/settings/features");
  });

  it("sets the digest a new missions team member starts on, from the tiers the church offers", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /email digest for new members/i }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText(/Start new Missions team members on/);
    expect(within(select).queryByRole("option", { name: "Biweekly" })).toBeNull();
    fireEvent.change(select, { target: { value: "monthly" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateChurchSettings).toHaveBeenCalledWith({ defaultDigestCadence: "monthly" })
    );
  });

  it("hides the digest setting while email is off", async () => {
    features = { careTeam: true, keyDates: true, outboundEmail: false };
    renderIt();
    await screen.findByText(/Nobody is on the Missions team/);
    expect(screen.queryByText("Email digest")).toBeNull();
  });
});
