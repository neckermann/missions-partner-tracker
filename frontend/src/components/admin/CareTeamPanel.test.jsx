import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CareTeamPanel from "./CareTeamPanel.jsx";
import { fetchCareTeam, setCareTeam, fetchCareTeamCandidates, fetchMissionsTeam } from "../../api/client.js";

// One Lead plus Members per partner. Everyone who can see the partner sees the team; only
// admin/editor can change it.
vi.mock("../../api/client.js", () => ({
  fetchCareTeam: vi.fn(),
  setCareTeam: vi.fn(),
  fetchCareTeamCandidates: vi.fn(),
  fetchMissionsTeam: vi.fn(),
}));
vi.mock("../../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {}, ownerGroupName: "Missions team" }),
}));

const ann = { userId: "u1", firstName: "Ann", lastName: "Lead", role: "editor", email: "ann@example.test" };
const bob = { userId: "u2", firstName: "Bob", lastName: "Member", role: "guest" };
const candidates = [
  { id: "u1", email: "ann@example.test", firstName: "Ann", lastName: "Lead", role: "editor" },
  { id: "u2", email: "bob@example.test", firstName: "Bob", lastName: "Member", role: "guest" },
  { id: "u3", email: "cat@example.test", firstName: "Cat", lastName: "Other", role: "viewer" },
];

function renderPanel(props = {}) {
  render(
    <MemoryRouter>
      <CareTeamPanel partnerId="p1" canEdit {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCareTeamCandidates.mockResolvedValue(candidates);
  fetchMissionsTeam.mockResolvedValue({ members: [], candidates: [] });
});

describe("CareTeamPanel, compact (the line on the contact card)", () => {
  it("names the team on one line, with the lead marked, and offers Edit team", async () => {
    fetchCareTeam.mockResolvedValue({ lead: { ...ann, isLead: true }, members: [{ ...bob, isLead: false }] });
    renderPanel({ compact: true });
    expect(await screen.findByText("Ann Lead")).toBeInTheDocument();
    expect(screen.getByText("(lead)")).toBeInTheDocument();
    expect(screen.getByText("Bob Member")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit team" })).toBeInTheDocument();
  });

  it("says nobody is assigned and offers to assign a team", async () => {
    fetchCareTeam.mockResolvedValue({ lead: null, members: [] });
    renderPanel({ compact: true });
    expect(await screen.findByText(/nobody assigned yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Assign team" })).toBeInTheDocument();
  });

  it("has no button for someone who can't edit", async () => {
    fetchCareTeam.mockResolvedValue({ lead: { ...ann, isLead: true }, members: [] });
    renderPanel({ compact: true, canEdit: false });
    expect(await screen.findByText("Ann Lead")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("CareTeamPanel", () => {
  it("shows the lead and the members, marking a guest", async () => {
    fetchCareTeam.mockResolvedValue({ lead: { ...ann, isLead: true }, members: [{ ...bob, isLead: false }] });
    renderPanel();

    expect(await screen.findByText("Ann Lead")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Bob Member")).toBeInTheDocument();
    expect(screen.getByText(/Member · Guest/)).toBeInTheDocument();
  });

  it("says so when nobody is assigned, and when there is no lead", async () => {
    fetchCareTeam.mockResolvedValue({ lead: null, members: [] });
    renderPanel();
    expect(await screen.findByText(/Nobody is assigned/)).toBeInTheDocument();
  });

  it("flags a team that has members but no lead", async () => {
    fetchCareTeam.mockResolvedValue({ lead: null, members: [{ ...bob, isLead: false }] });
    renderPanel();
    expect(await screen.findByText("No lead yet.")).toBeInTheDocument();
  });

  it("offers no edit control to someone who can't change the team", async () => {
    fetchCareTeam.mockResolvedValue({ lead: { ...ann, isLead: true }, members: [] });
    renderPanel({ canEdit: false });
    await screen.findByText("Ann Lead");
    expect(screen.queryByRole("button", { name: /care team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assign/i })).not.toBeInTheDocument();
  });

  it("sets the lead and members in one save", async () => {
    fetchCareTeam.mockResolvedValue({ lead: null, members: [] });
    setCareTeam.mockResolvedValue({ lead: { ...ann, isLead: true }, members: [{ ...bob, isLead: false }] });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /Assign care team/ }));
    const dialog = await screen.findByRole("dialog");
    const leadSelect = await within(dialog).findByRole("combobox");
    fireEvent.change(leadSelect, { target: { value: "u1" } });
    fireEvent.click(within(dialog).getByLabelText(/Bob Member/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(setCareTeam).toHaveBeenCalledWith("p1", { leadUserId: "u1", memberUserIds: ["u2"] })
    );
  });

  it("never lists the lead among the member choices", async () => {
    fetchCareTeam.mockResolvedValue({ lead: { ...ann, isLead: true }, members: [] });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /Edit care team/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Members");
    // Ann is the lead, so she's only an option in the Lead select
    expect(within(dialog).queryByRole("checkbox", { name: /Ann Lead/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Bob Member/ })).toBeInTheDocument();
  });

  it("offers an invite link only when asked to", async () => {
    fetchCareTeam.mockResolvedValue({ lead: null, members: [] });
    renderPanel({ canInviteGuest: true });
    fireEvent.click(await screen.findByRole("button", { name: /Assign care team/ }));
    expect(await screen.findByRole("link", { name: /Invite a new guest/ })).toHaveAttribute(
      "href",
      "/admin/settings/users/new?partnerId=p1"
    );
  });
});

// With nobody assigned, the missions team looks after the partner (its name is church wording).
describe("CareTeamPanel: the missions team looks after a partner with no team", () => {
  beforeEach(() => fetchCareTeam.mockResolvedValue({ lead: null, members: [] }));

  it("tells staff who looks after the partner until a team is set", async () => {
    fetchMissionsTeam.mockResolvedValue({ members: [{ id: "u1", name: "Ann Lead" }], candidates: [] });
    renderPanel();
    expect(await screen.findByText(/Missions team \(Ann Lead\) looks after this partner/)).toBeTruthy();
  });

  it("warns staff when nobody is on the missions team either", async () => {
    renderPanel();
    expect(await screen.findByText(/Nobody is on the Missions team yet/)).toBeTruthy();
  });

  it("names the group without listing people to someone who can't edit, and doesn't ask the server", async () => {
    renderPanel({ canEdit: false });
    expect(
      await screen.findByText(/The Missions team looks after this partner until a team is set/)
    ).toBeTruthy();
    expect(fetchMissionsTeam).not.toHaveBeenCalled();
  });

  it("doesn't mention the fallback once a team exists", async () => {
    fetchCareTeam.mockResolvedValue({ lead: ann, members: [] });
    renderPanel();
    await screen.findByText("Ann Lead");
    expect(screen.queryByText(/looks after this partner/)).toBeNull();
  });
});
