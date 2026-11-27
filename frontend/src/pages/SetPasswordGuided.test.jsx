import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SetPassword from "./SetPassword.jsx";
import * as client from "../api/client.js";

// The new-account page (#590): the link, then a choice of how to sign in, then signed in with no separate sign-in.
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
vi.mock("../api/client.js", () => ({
  validatePasswordSetup: vi.fn(),
  completePasswordSetup: vi.fn(),
  requestPasswordSetupLink: vi.fn(),
  startPasskeyLinkSetup: vi.fn(),
  registerPasskey: vi.fn(),
  startForcedMfaSetup: vi.fn(),
  confirmForcedMfaSetup: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

const NEW_ACCOUNT = {
  email: "dana@example.test",
  firstName: "Dana",
  reset: false,
  hasSecondFactor: false,
  passwordAllowed: true,
  passkeyAllowed: true,
};

function open(info) {
  client.validatePasswordSetup.mockResolvedValue({ ...NEW_ACCOUNT, ...info });
  render(
    <MemoryRouter initialEntries={["/set-password?token=abc"]}>
      <SetPassword />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  client.browserSupportsWebAuthn.mockReturnValue(true);
});

describe("the choice", () => {
  it("asks where they will mostly sign in, and explains the two proofs in plain words", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Welcome, Dana" })).toBeInTheDocument();
    expect(screen.getByText("Where will you mostly sign in?")).toBeInTheDocument();
    expect(screen.getByText("Why do we ask for two proofs?")).toBeInTheDocument();
    expect(screen.getByLabelText(/Mostly on this device/)).toBeChecked();
  });

  it("a passkey on this device: creates it with the enrolment token and goes to the site", async () => {
    client.startPasskeyLinkSetup.mockResolvedValue({ setupToken: "setup-1" });
    client.registerPasskey.mockResolvedValue({ user: {} });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Create your passkey" })).toBeInTheDocument();
    expect(screen.getByText(/a passkey has no recovery codes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a passkey on this device" }));
    await waitFor(() => expect(client.registerPasskey).toHaveBeenCalledWith("", "setup-1"));
    expect(client.startPasskeyLinkSetup).toHaveBeenCalledWith("abc");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
  });

  it("a cancelled passkey prompt can be tried again without spending the link twice", async () => {
    client.startPasskeyLinkSetup.mockResolvedValue({ setupToken: "setup-1" });
    client.registerPasskey.mockRejectedValueOnce({ name: "NotAllowedError" }).mockResolvedValueOnce({});
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    const make = await screen.findByRole("button", { name: "Create a passkey on this device" });
    fireEvent.click(make);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a passkey on this device" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
    expect(client.startPasskeyLinkSetup).toHaveBeenCalledTimes(1);
  });

  it("shared computers: a password, then the authenticator app, then recovery codes, then the site", async () => {
    client.completePasswordSetup.mockResolvedValue({ ok: true, setupToken: "setup-2" });
    client.startForcedMfaSetup.mockResolvedValue({ secret: "ABCD", qrCode: "data:image/png;base64,xx" });
    client.confirmForcedMfaSetup.mockResolvedValue({ user: {}, recoveryCodes: ["aaaa-bbbb", "cccc-dddd"] });
    open();
    fireEvent.click(await screen.findByLabelText(/On different or shared computers/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "a-long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a-long-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(client.completePasswordSetup).toHaveBeenCalledWith("abc", "a-long-password"));
    expect(await screen.findByRole("heading", { name: "Add your authenticator app" })).toBeInTheDocument();
    // The app step does not offer a passkey: they chose a password.
    expect(screen.queryByRole("button", { name: "Use a passkey" })).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    expect(await screen.findByText("aaaa-bbbb")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a browser that can't make a passkey goes straight to the password route", async () => {
    client.browserSupportsWebAuthn.mockReturnValue(false);
    open();
    expect(await screen.findByText(/can't make a passkey/)).toBeInTheDocument();
    expect(screen.queryByText("Where will you mostly sign in?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Choose a password" })).toBeInTheDocument();
  });

  it("a church that signs in with a passkey only offers the passkey", async () => {
    open({ passwordAllowed: false });
    expect(await screen.findByText(/signs in with a passkey/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Create your passkey" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });
});

describe("an account that already has two-factor", () => {
  it("only changes the password and sends them to sign in, never offering a new second factor", async () => {
    client.completePasswordSetup.mockResolvedValue({ ok: true, mfaRequired: true });
    open({ reset: true, hasSecondFactor: true });
    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByText("Where will you mostly sign in?")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a-long-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("heading", { name: "Password changed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
    expect(navigate).not.toHaveBeenCalled();
  });
});
