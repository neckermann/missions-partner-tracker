import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AccountSettings from "./AccountSettings.jsx";
import { fetchCurrentUser, fetchPartners, updateNotifyByEmail } from "../api/client.js";

// AccountSettings' cadence picker: filtered to the enabled tiers, but the signed-in admin's
// own already-saved cadence stays visible and selectable even if it has since been disabled (a
// current choice is never silently hidden). The MFA and password-change sections are not
// exercised here.
vi.mock("../api/client.js", () => ({
  fetchPasskeys: vi.fn().mockResolvedValue({ passkeys: [], max: 5 }),
  registerPasskey: vi.fn(),
  removePasskey: vi.fn(),
  browserSupportsWebAuthn: () => true,
  fetchCurrentUser: vi.fn(),
  changePassword: vi.fn(),
  setupMfa: vi.fn(),
  verifyMfaSetup: vi.fn(),
  disableMfa: vi.fn(),
  updateNotifyByEmail: vi.fn(),
  fetchPartners: vi.fn(),
}));

let cadenceTiersEnabled;
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({
    enabledFeatures: { outboundEmail: true },
    cadenceTiersEnabled,
    ownerGroupName: "Missions team",
  }),
}));

function baseUser(overrides = {}) {
  return {
    id: "u1",
    email: "admin@example.test",
    role: "admin",
    authProvider: "local",
    mfaEnabled: false,
    cadence: null,
    digestScope: "all",
    followedPartnerIds: [],
    ...overrides,
  };
}

async function openEmailDispatchSection() {
  await waitFor(() => expect(screen.getByRole("button", { name: /Email Dispatch/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Email Dispatch/ }));
}

function cadenceSelect() {
  return screen.getByLabelText("Digest cadence");
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchPartners.mockResolvedValue([]);
});

describe("AccountSettings -- Email Dispatch cadence picker", () => {
  it("offers only the enabled tiers (plus 'No automatic digest') when the admin has no saved cadence", async () => {
    cadenceTiersEnabled = { biweekly: false, monthly: true, quarterly: true };
    fetchCurrentUser.mockResolvedValue(baseUser({ cadence: null }));
    render(<AccountSettings />);
    await openEmailDispatchSection();

    const options = within(cadenceSelect())
      .getAllByRole("option")
      .map((o) => o.value);
    expect(options).toEqual(["", "monthly", "quarterly"]);
  });

  it("keeps a disabled tier visible and selected when it's the admin's own already-saved cadence", async () => {
    cadenceTiersEnabled = { biweekly: false, monthly: true, quarterly: true };
    fetchCurrentUser.mockResolvedValue(baseUser({ cadence: "biweekly" }));
    render(<AccountSettings />);
    await openEmailDispatchSection();

    const select = cadenceSelect();
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.value);
    expect(options).toContain("biweekly");
    expect(select.value).toBe("biweekly");
  });

  it("drops a tier from the picker once the admin's own saved cadence is no longer that tier", async () => {
    cadenceTiersEnabled = { biweekly: false, monthly: true, quarterly: true };
    fetchCurrentUser.mockResolvedValue(baseUser({ cadence: "monthly" }));
    render(<AccountSettings />);
    await openEmailDispatchSection();

    const options = within(cadenceSelect())
      .getAllByRole("option")
      .map((o) => o.value);
    expect(options).not.toContain("biweekly");
  });

  it("reflects all three tiers enabled", async () => {
    cadenceTiersEnabled = { biweekly: true, monthly: true, quarterly: true };
    fetchCurrentUser.mockResolvedValue(baseUser({ cadence: null }));
    render(<AccountSettings />);
    await openEmailDispatchSection();

    const options = within(cadenceSelect())
      .getAllByRole("option")
      .map((o) => o.value);
    expect(options).toEqual(["", "biweekly", "monthly", "quarterly"]);
  });

  it("saves the picked cadence through updateNotifyByEmail", async () => {
    cadenceTiersEnabled = { biweekly: false, monthly: true, quarterly: true };
    fetchCurrentUser.mockResolvedValue(baseUser({ cadence: null }));
    updateNotifyByEmail.mockResolvedValue({});
    render(<AccountSettings />);
    await openEmailDispatchSection();

    fireEvent.change(cadenceSelect(), { target: { value: "monthly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateNotifyByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ cadence: "monthly", digestScope: "all" })
      )
    );
  });
});

describe("AccountSettings -- what the digest covers", () => {
  beforeEach(() => {
    cadenceTiersEnabled = { biweekly: false, monthly: true, quarterly: true };
  });

  it("offers the partners you look after, all partners, or hand-picked ones, and saves the choice", async () => {
    fetchCurrentUser.mockResolvedValue(
      baseUser({ cadence: "monthly", digestScope: "owned", onMissionsTeam: true })
    );
    updateNotifyByEmail.mockResolvedValue({});
    render(<AccountSettings />);
    await openEmailDispatchSection();
    expect(screen.getByRole("radio", { name: /partners I look after .*Missions team/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "All partners" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateNotifyByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ cadence: "monthly", digestScope: "all" })
      )
    );
  });

  it("shows a care team guest with a seat their own partners only, with no scope choice", async () => {
    fetchCurrentUser.mockResolvedValue(
      baseUser({ role: "guest", cadence: "monthly", careTeamSeats: [{ id: "p1", label: "The Reeds" }] })
    );
    render(<AccountSettings />);
    await openEmailDispatchSection();
    expect(screen.getByText(/covers the partners you look after, and only them/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("hides the digest from a guest who has no seat", async () => {
    fetchCurrentUser.mockResolvedValue(baseUser({ role: "guest", careTeamSeats: [] }));
    render(<AccountSettings />);
    await screen.findByText("Change Password");
    expect(screen.queryByRole("button", { name: /Email Dispatch/ })).toBeNull();
  });
});
