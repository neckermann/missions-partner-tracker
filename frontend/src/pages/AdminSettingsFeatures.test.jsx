// The Enabled Features page: a dependency is declared once in the server's registry (`requires`), and the
// page nests, disables and saves from that, instead of special-casing individual features.
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSettingsFeatures from "./AdminSettingsFeatures.jsx";

const updateChurchSettings = vi.fn();
vi.mock("../api/client.js", () => ({ updateChurchSettings: (...a) => updateChurchSettings(...a) }));
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => ({ refreshSettings: vi.fn() }) }));

const registry = [
  {
    key: "outboundEmail",
    label: "Email (Sending)",
    description: "Email.",
    defaultEnabled: false,
    group: "admin",
    requires: [],
  },
  {
    key: "digest",
    label: "Prayer digest",
    description: "Digest.",
    defaultEnabled: false,
    group: "admin",
    requires: [],
    setupNeeds: ["outboundEmail"],
  },
  {
    key: "careTeam",
    label: "Care teams",
    description: "Teams.",
    defaultEnabled: false,
    group: "admin",
    requires: [],
  },
  {
    key: "keyDates",
    label: "Key-date reminders",
    description: "Reminders.",
    defaultEnabled: false,
    group: "admin",
    requires: ["careTeam"],
  },
  {
    key: "surveys",
    label: "Partner surveys",
    description: "Surveys.",
    defaultEnabled: false,
    group: "admin",
    requires: [],
  },
];
let stored;
vi.mock("../hooks/useChurchSettings.js", () => ({
  default: () => ({ settings: { enabledFeatures: stored, featureRegistry: registry }, loading: false }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminSettingsFeatures />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  updateChurchSettings.mockResolvedValue({ enabledFeatures: stored });
  stored = {};
});

describe("Enabled Features (requirements come from the registry)", () => {
  test("says what a feature needs, and reads Off while a requirement is off", () => {
    stored = { keyDates: true, careTeam: false };
    renderPage();
    const row = screen.getByText("Key-date reminders").closest("li");
    expect(within(row).getByText("Off")).toBeInTheDocument();
    expect(within(row).getByText(/Needs Care teams turned on/)).toBeInTheDocument();
  });

  test("a setup-only prerequisite blocks switching it on but doesn't make a running feature read Off", () => {
    stored = { digest: true, outboundEmail: false };
    renderPage();
    const row = screen.getByText("Prayer digest").closest("li");
    expect(within(row).getByText("On")).toBeInTheDocument();
    expect(within(row).getByText(/Needs Email \(Sending\) turned on/)).toBeInTheDocument();
  });

  test("a feature with no requirements is switchable on its own", () => {
    stored = { surveys: true };
    renderPage();
    const row = screen.getByText("Partner surveys").closest("li");
    expect(within(row).getByText("On")).toBeInTheDocument();
    expect(within(row).queryByText(/Needs/)).toBeNull();
  });

  test("in the editor the child is disabled until its requirement is on, and saving turns it off with the requirement", async () => {
    stored = { careTeam: true, keyDates: true };
    renderPage();
    fireEvent.click(screen.getByText("Admin Features"));
    const boxes = await screen.findAllByRole("checkbox");
    // Order: Email, Prayer digest (nested), Care teams, Key-date reminders (nested), Partner surveys.
    expect(boxes).toHaveLength(5);
    expect(boxes[3]).toBeEnabled();
    fireEvent.click(boxes[2]); // turn Care teams off
    expect(boxes[3]).toBeDisabled();
    expect(screen.getByText(/Needs Care teams turned on first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(updateChurchSettings).toHaveBeenCalled());
    const sent = updateChurchSettings.mock.calls[0][0].enabledFeatures;
    expect(sent.careTeam).toBe(false);
    expect(sent.keyDates).toBe(false); // forced off with its requirement
  });
});
