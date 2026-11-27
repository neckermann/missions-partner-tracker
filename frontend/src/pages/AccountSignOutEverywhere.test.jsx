import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccountSettings from "./AccountSettings.jsx";
import { fetchCurrentUser, fetchPartners, logoutEverywhere } from "../api/client.js";

// My Account's "Sign out of all devices": asks first, then ends every session and goes to the sign-in page.
vi.mock("../api/client.js", () => ({
  fetchPasskeys: vi.fn().mockResolvedValue({ passkeys: [], max: 5 }),
  browserSupportsWebAuthn: () => true,
  fetchCurrentUser: vi.fn(),
  fetchPartners: vi.fn(),
  logoutEverywhere: vi.fn(),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {}, cadenceTiersEnabled: [], ownerGroupName: "Missions team" }),
}));

const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetchPartners.mockResolvedValue([]);
  fetchCurrentUser.mockResolvedValue({
    id: "u1",
    email: "a@example.test",
    role: "editor",
    authProvider: "local",
    mfaEnabled: false,
  });
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

const open = async () => {
  render(<AccountSettings />);
  return screen.findByRole("button", { name: "Sign out of all devices" });
};

describe("Sign out of all devices", () => {
  it("asks first and does nothing when you cancel", async () => {
    fireEvent.click(await open());
    expect(await screen.findByText(/need to sign in again/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/need to sign in again/)).toBeNull());
    expect(logoutEverywhere).not.toHaveBeenCalled();
  });

  it("ends every session and goes to the sign-in page once you confirm", async () => {
    logoutEverywhere.mockResolvedValue();
    fireEvent.click(await open());
    fireEvent.click(await screen.findByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(logoutEverywhere).toHaveBeenCalledTimes(1);
  });

  it("a failure says so and leaves you signed in", async () => {
    logoutEverywhere.mockRejectedValue({ response: { data: { error: "Not on the demo" } } });
    fireEvent.click(await open());
    fireEvent.click(await screen.findByRole("button", { name: "Sign out everywhere" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Not on the demo/);
    expect(assign).not.toHaveBeenCalled();
  });
});
