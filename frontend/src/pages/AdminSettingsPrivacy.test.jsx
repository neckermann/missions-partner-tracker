import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminSettingsPrivacy from "./AdminSettingsPrivacy.jsx";
import {
  fetchDispatchSettings,
  updateDispatchSettings,
  fetchChurchSettings,
  updateChurchSettings,
} from "../api/client.js";

// A4 of the November 2026 app review: the restricted-partner settings used to live only on the
// Dispatches page, which a default install (no GroupMe, WhatsApp or email) cannot open. This page has
// no feature gate, so these tests render it with every messaging feature off.
vi.mock("../api/client.js", () => ({
  fetchDispatchSettings: vi.fn(),
  updateDispatchSettings: vi.fn(),
  fetchChurchSettings: vi.fn(),
  updateChurchSettings: vi.fn(),
}));
const refreshSettings = vi.fn();
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {}, refreshSettings }),
}));

const dispatch = { allowRestrictedPartnerDispatch: false, restrictedPartnerInitialsEnabled: true };
const church = {
  enabledFeatures: { trips: true },
  featureRegistry: [
    { key: "publicDirectory", defaultEnabled: true },
    { key: "publicMap", defaultEnabled: true },
  ],
};

function renderPage() {
  render(
    <MemoryRouter>
      <AdminSettingsPrivacy />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchDispatchSettings.mockResolvedValue(dispatch);
  fetchChurchSettings.mockResolvedValue(church);
  updateDispatchSettings.mockImplementation(async (patch) => ({ ...dispatch, ...patch }));
  updateChurchSettings.mockResolvedValue(church);
});

describe("Privacy and safety settings", () => {
  it("shows what the public can see and the restricted-partner choices, with no messaging feature on", async () => {
    renderPage();
    expect(await screen.findByText("Public directory: On")).toBeInTheDocument();
    expect(screen.getByText("Public map: On")).toBeInTheDocument();
    expect(screen.getByText(/Never recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Initials \(for example "J.R."\)/)).toBeInTheDocument();
  });

  it("saves the restricted-partner choices on their own", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Partners in sensitive places/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(/Show initials for restricted partners/));
    fireEvent.click(within(dialog).getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(updateDispatchSettings).toHaveBeenCalledWith({
        allowRestrictedPartnerDispatch: false,
        restrictedPartnerInitialsEnabled: false,
      })
    );
    expect(updateChurchSettings).not.toHaveBeenCalled();
  });

  it("turns the public directory off, keeping every other feature setting as it was", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /What the public can see/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Public directory"));
    fireEvent.click(within(dialog).getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(updateChurchSettings).toHaveBeenCalledWith({
        enabledFeatures: { trips: true, publicDirectory: false, publicMap: true },
      })
    );
    expect(refreshSettings).toHaveBeenCalled();
  });
});
