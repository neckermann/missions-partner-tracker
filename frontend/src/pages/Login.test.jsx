// #386: the second step of sign-in offers a passkey and/or the authenticator-app code, according to
// what the account has; forced enrolment can finish with a passkey.
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Login from "./Login.jsx";
import * as client from "../api/client.js";

vi.mock("../api/client.js", () => ({
  login: vi.fn(),
  verifyMfaLogin: vi.fn(),
  startForcedMfaSetup: vi.fn(),
  confirmForcedMfaSetup: vi.fn(),
  fetchSetupStatus: vi.fn().mockResolvedValue({ needed: false }),
  loginWithPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));

async function signIn() {
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  client.browserSupportsWebAuthn.mockReturnValue(true);
  client.fetchSetupStatus.mockResolvedValue({ needed: false });
});

describe("second step", () => {
  test("an account with only an authenticator app sees the code form and no passkey button", async () => {
    client.login.mockResolvedValue({
      mfaRequired: true,
      pendingToken: "t",
      methods: { authenticatorApp: true, passkey: false },
    });
    await signIn();
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use a passkey" })).not.toBeInTheDocument();
  });

  test("a passkey-only account signs in with the passkey and has no code box", async () => {
    client.login.mockResolvedValue({
      mfaRequired: true,
      pendingToken: "tok",
      methods: { authenticatorApp: false, passkey: true },
    });
    client.loginWithPasskey.mockResolvedValue({ user: {} });
    await signIn();
    fireEvent.click(await screen.findByRole("button", { name: "Use a passkey" }));
    await waitFor(() => expect(client.loginWithPasskey).toHaveBeenCalledWith("tok"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  });

  test("an account with both offers either, and a failed passkey keeps the code form available", async () => {
    client.login.mockResolvedValue({
      mfaRequired: true,
      pendingToken: "tok",
      methods: { authenticatorApp: true, passkey: true },
    });
    client.loginWithPasskey.mockRejectedValue({ response: { data: { error: "That passkey didn't work" } } });
    await signIn();
    fireEvent.click(await screen.findByRole("button", { name: "Use a passkey" }));
    expect(await screen.findByText("That passkey didn't work")).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("a passkey-only account on a browser without passkey support is told what to do", async () => {
    client.browserSupportsWebAuthn.mockReturnValue(false);
    client.login.mockResolvedValue({
      mfaRequired: true,
      pendingToken: "tok",
      methods: { authenticatorApp: false, passkey: true },
    });
    await signIn();
    expect(await screen.findByText(/can't use passkeys/)).toBeInTheDocument();
  });
});

describe("forced enrolment", () => {
  test("offers a passkey and signs in once it is added", async () => {
    client.login.mockResolvedValue({ mfaSetupRequired: true, setupToken: "setup" });
    client.startForcedMfaSetup.mockResolvedValue({ secret: "S", qrCode: "data:image/png;base64,AA" });
    client.registerPasskey.mockResolvedValue({ user: {} });
    await signIn();
    fireEvent.click(await screen.findByRole("button", { name: "Use a passkey" }));
    await waitFor(() => expect(client.registerPasskey).toHaveBeenCalledWith("", "setup"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
  });

  test("without browser support only the authenticator app is offered", async () => {
    client.browserSupportsWebAuthn.mockReturnValue(false);
    client.login.mockResolvedValue({ mfaSetupRequired: true, setupToken: "setup" });
    client.startForcedMfaSetup.mockResolvedValue({ secret: "S", qrCode: "data:image/png;base64,AA" });
    await signIn();
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use a passkey" })).not.toBeInTheDocument();
  });
});
