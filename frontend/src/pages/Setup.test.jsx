import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Setup from "./Setup.jsx";
import * as client from "../api/client.js";

// First-run setup creates the first admin. They choose how they will sign in (a passkey, or a password and an
// authenticator app) and are signed in at the end, with no separate sign-in step.
vi.mock("../api/client.js", () => ({
  fetchSetupStatus: vi.fn(),
  completeSetup: vi.fn(),
  registerPasskey: vi.fn(),
  startForcedMfaSetup: vi.fn(),
  confirmForcedMfaSetup: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

function renderSetup() {
  render(
    <MemoryRouter initialEntries={["/setup"]}>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/admin" element={<p>the admin app</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const typeEmail = async () =>
  fireEvent.change(await screen.findByLabelText(/^Your email/), { target: { value: "first@church.test" } });

beforeEach(() => {
  vi.clearAllMocks();
  client.browserSupportsWebAuthn.mockReturnValue(true);
  client.fetchSetupStatus.mockResolvedValue({ needed: true, passkeySignIn: true });
  client.completeSetup.mockResolvedValue({ ok: true, mfaSetupRequired: true, setupToken: "setup-1" });
});

describe("Setup", () => {
  it("sends an install that already has an admin to the sign-in page", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false });
    renderSetup();
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("a passkey: creates the admin with no password, registers the passkey, and lands in the admin app", async () => {
    client.registerPasskey.mockResolvedValue({});
    renderSetup();
    await typeEmail();
    expect(screen.getByText("Where will you mostly sign in?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create a passkey on this device" }));
    await waitFor(() =>
      expect(client.completeSetup).toHaveBeenCalledWith("first@church.test", undefined, "passkey", {
        firstName: "",
        lastName: "",
      })
    );
    await waitFor(() => expect(client.registerPasskey).toHaveBeenCalledWith("", "setup-1"));
    expect(await screen.findByText("the admin app")).toBeInTheDocument();
  });

  it("a cancelled passkey prompt can be retried without creating the account twice", async () => {
    client.registerPasskey.mockRejectedValueOnce({ name: "NotAllowedError" }).mockResolvedValueOnce({});
    renderSetup();
    await typeEmail();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create a passkey on this device" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a passkey on this device" }));
    expect(await screen.findByText("the admin app")).toBeInTheDocument();
    expect(client.completeSetup).toHaveBeenCalledTimes(1);
  });

  it("shared computers: a password, then the authenticator app and recovery codes, then the admin app", async () => {
    client.startForcedMfaSetup.mockResolvedValue({ secret: "ABCD", qrCode: "data:image/png;base64,xx" });
    client.confirmForcedMfaSetup.mockResolvedValue({ recoveryCodes: ["aaaa-bbbb"] });
    renderSetup();
    await typeEmail();
    fireEvent.click(screen.getByLabelText(/On different or shared computers/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const [password, confirm] = await screen.findAllByLabelText(/password/i);
    fireEvent.change(password, { target: { value: "A-Strong-Passw0rd!" } });
    fireEvent.change(confirm, { target: { value: "A-Strong-Passw0rd!" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(client.completeSetup).toHaveBeenCalledWith(
        "first@church.test",
        "A-Strong-Passw0rd!",
        "password",
        {
          firstName: "",
          lastName: "",
        }
      )
    );
    expect(await screen.findByRole("heading", { name: "Add your authenticator app" })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    expect(await screen.findByText("aaaa-bbbb")).toBeInTheDocument();
  });

  it("refuses mismatched passwords before asking the server", async () => {
    client.browserSupportsWebAuthn.mockReturnValue(false);
    renderSetup();
    await typeEmail();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const [password, confirm] = await screen.findAllByLabelText(/password/i);
    fireEvent.change(password, { target: { value: "A-Strong-Passw0rd!" } });
    fireEvent.change(confirm, { target: { value: "Something-else-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(client.completeSetup).not.toHaveBeenCalled();
  });

  it("asks for the administrator's name, optional, and sends it with the account", async () => {
    client.registerPasskey.mockResolvedValue({});
    renderSetup();
    fireEvent.change(await screen.findByLabelText("Your first name"), { target: { value: "Dana" } });
    fireEvent.change(screen.getByLabelText("Your last name"), { target: { value: "Reed" } });
    expect(screen.getByText(/Shown beside the changes you make/)).toBeInTheDocument();
    await typeEmail();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create a passkey on this device" }));
    await waitFor(() =>
      expect(client.completeSetup).toHaveBeenCalledWith("first@church.test", undefined, "passkey", {
        firstName: "Dana",
        lastName: "Reed",
      })
    );
  });

  it("does not require a name", async () => {
    renderSetup();
    expect(await screen.findByLabelText("Your first name")).not.toBeRequired();
    expect(screen.getByLabelText("Your last name")).not.toBeRequired();
  });
});
