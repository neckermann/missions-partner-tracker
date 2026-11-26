import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminDispatchSettings from "./AdminDispatchSettings.jsx";
import { fetchDispatchSettings, updateDispatchSettings } from "../api/client.js";

// The chat schedule card: the three content mutes (on by default) and the three opt-in partner care posts
// (off by default), with the care posts summarised separately from "Muted".
vi.mock("../api/client.js", () => ({
  fetchDispatchSettings: vi.fn(),
  updateDispatchSettings: vi.fn(),
  fetchScopedDigestSummary: vi.fn().mockResolvedValue(null),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: { groupme: true } }),
}));
vi.mock("../components/admin/TemplatePackButtons.jsx", () => ({ default: () => null }));

const base = {
  chatDispatchHour: 9,
  chatDispatchPrayerRequests: true,
  chatDispatchOneTimeNeeds: true,
  chatDispatchNewsletters: true,
  chatDispatchKeyDates: false,
  chatDispatchQuietPartners: false,
  chatDispatchUpdatesToPass: false,
  allowRestrictedPartnerDispatch: false,
  restrictedPartnerInitialsEnabled: true,
  cadenceBiweeklyEnabled: false,
  cadenceMonthlyEnabled: true,
  cadenceQuarterlyEnabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchDispatchSettings.mockResolvedValue(base);
  updateDispatchSettings.mockImplementation(async (patch) => ({ ...base, ...patch }));
});

describe("AdminDispatchSettings -- partner care posts", () => {
  it("shows partner care posts as off until turned on", async () => {
    render(
      <MemoryRouter>
        <AdminDispatchSettings />
      </MemoryRouter>
    );
    expect(await screen.findByText(/Partner care posts:/)).toHaveTextContent("None (off)");
  });

  it("turns key dates on and saves it with the chat settings", async () => {
    render(
      <MemoryRouter>
        <AdminDispatchSettings />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: /GroupMe Schedule/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Key dates coming up/)).not.toBeChecked();
    fireEvent.click(within(dialog).getByLabelText(/Key dates coming up/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateDispatchSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chatDispatchKeyDates: true,
          chatDispatchQuietPartners: false,
          chatDispatchUpdatesToPass: false,
          chatDispatchPrayerRequests: true,
        })
      )
    );
  });
});
