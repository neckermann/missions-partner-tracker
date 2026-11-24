// #386: the Passkeys section on My account, and how Two-Factor Authentication reads with one.
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AccountSettings from "./AccountSettings.jsx";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({
  fetchCurrentUser: vi.fn(),
  changePassword: vi.fn(),
  setupMfa: vi.fn(),
  verifyMfaSetup: vi.fn(),
  disableMfa: vi.fn(),
  updateNotifyByEmail: vi.fn(),
  setKeyDateEmailOptOut: vi.fn(),
  fetchPartners: vi.fn().mockResolvedValue([]),
  fetchPasskeys: vi.fn(),
  registerPasskey: vi.fn(),
  removePasskey: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {}, cadenceTiersEnabled: [] }),
}));

const user = (o = {}) => ({
  id: "u1",
  email: "a@example.test",
  role: "editor",
  authProvider: "local",
  mfaEnabled: false,
  authenticatorApp: false,
  passkeyCount: 0,
  ...o,
});
const passkey = (o = {}) => ({
  id: "p1",
  label: "My phone",
  createdAt: "2026-11-01T00:00:00Z",
  lastUsedAt: null,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  client.browserSupportsWebAuthn.mockReturnValue(true);
  client.fetchPasskeys.mockResolvedValue({ passkeys: [], max: 5 });
});

describe("Passkeys on My account", () => {
  test("adds a passkey with the chosen name, then reloads the list and the account", async () => {
    client.fetchCurrentUser.mockResolvedValue(user());
    client.registerPasskey.mockResolvedValue({ ok: true });
    render(<AccountSettings />);
    fireEvent.change(await screen.findByLabelText(/Name \(optional\)/), { target: { value: "Work laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
    await waitFor(() => expect(client.registerPasskey).toHaveBeenCalledWith("Work laptop"));
    expect(await screen.findByText("Passkey added.")).toBeInTheDocument();
    expect(client.fetchPasskeys).toHaveBeenCalledTimes(2);
  });

  test("a cancelled browser prompt reads as a plain message, not an error code", async () => {
    client.fetchCurrentUser.mockResolvedValue(user());
    client.registerPasskey.mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    render(<AccountSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
    expect(await screen.findByText(/That was cancelled/)).toBeInTheDocument();
  });

  test("lists them and removes one only with the password", async () => {
    client.fetchCurrentUser.mockResolvedValue(user({ mfaEnabled: true, passkeyCount: 1 }));
    client.fetchPasskeys.mockResolvedValue({ passkeys: [passkey()], max: 5 });
    client.removePasskey.mockResolvedValue({ ok: true });
    render(<AccountSettings />);
    expect(await screen.findByText("My phone")).toBeInTheDocument();
    expect(screen.getByText(/not used yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove passkey" }));
    await waitFor(() => expect(client.removePasskey).toHaveBeenCalledWith("p1", "hunter2hunter2"));
  });

  test("shows the server's reason when the last factor can't be removed", async () => {
    client.fetchCurrentUser.mockResolvedValue(user({ mfaEnabled: true, passkeyCount: 1 }));
    client.fetchPasskeys.mockResolvedValue({ passkeys: [passkey()], max: 5 });
    client.removePasskey.mockRejectedValue({
      response: { data: { error: "Your church requires two-factor authentication." } },
    });
    render(<AccountSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove passkey" }));
    expect(await screen.findByText(/church requires two-factor/)).toBeInTheDocument();
  });

  test("says so at the limit, and when the browser can't make passkeys", async () => {
    client.fetchCurrentUser.mockResolvedValue(user({ mfaEnabled: true, passkeyCount: 5 }));
    client.fetchPasskeys.mockResolvedValue({
      passkeys: [1, 2, 3, 4, 5].map((n) => passkey({ id: `p${n}`, label: `Key ${n}` })),
      max: 5,
    });
    const { unmount } = render(<AccountSettings />);
    expect(await screen.findByText(/most passkeys allowed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument();
    unmount();

    client.fetchPasskeys.mockResolvedValue({ passkeys: [], max: 5 });
    client.browserSupportsWebAuthn.mockReturnValue(false);
    render(<AccountSettings />);
    expect(await screen.findByText(/can't create passkeys/)).toBeInTheDocument();
  });

  test("with only passkeys, Two-Factor says so and offers no authenticator-app switch-off", async () => {
    client.fetchCurrentUser.mockResolvedValue(user({ mfaEnabled: true, passkeyCount: 1 }));
    client.fetchPasskeys.mockResolvedValue({ passkeys: [passkey()], max: 5 });
    render(<AccountSettings />);
    expect(await screen.findByText("Enabled with passkeys")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Disable Two-Factor/ })).not.toBeInTheDocument();
  });

  test("with an app and a passkey, the switch-off is for the app alone", async () => {
    client.fetchCurrentUser.mockResolvedValue(
      user({ mfaEnabled: true, authenticatorApp: true, passkeyCount: 1 })
    );
    client.fetchPasskeys.mockResolvedValue({ passkeys: [passkey()], max: 5 });
    render(<AccountSettings />);
    expect(
      await screen.findByRole("button", { name: "Stop using the authenticator app" })
    ).toBeInTheDocument();
  });
});
