// The second step of sign-in offers a passkey and/or the authenticator-app code, according to
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
  signInWithPasskeyOnly: vi.fn(),
  requestSignInLink: vi.fn(),
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

describe("a passkey beside the password form", () => {
  const renderLogin = () =>
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

  test("is offered when the church allows it, and signs in with it alone", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: true });
    client.signInWithPasskeyOnly.mockResolvedValue({ user: {} });
    renderLogin();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
    await waitFor(() => expect(client.signInWithPasskeyOnly).toHaveBeenCalled());
  });

  test("is not shown when the church hasn't allowed it, or the browser can't use one", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: false });
    const { unmount } = renderLogin();
    await screen.findByLabelText("Password");
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
    unmount();
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: true });
    client.browserSupportsWebAuthn.mockReturnValue(false);
    renderLogin();
    await screen.findByLabelText("Password");
    await waitFor(() => expect(client.fetchSetupStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
    client.browserSupportsWebAuthn.mockReturnValue(true);
  });
});

describe("passwordless sign-in (#386 Layer 2)", () => {
  async function renderPasswordless() {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: true });
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    await screen.findByRole("button", { name: "Email me a sign-in link" });
  }

  test("offers a passkey and an emailed link, not a password", async () => {
    await renderPasswordless();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with a passkey" })).toBeInTheDocument();
  });

  test("signs in with a passkey alone", async () => {
    client.signInWithPasskeyOnly.mockResolvedValue({ user: {} });
    await renderPasswordless();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
    await waitFor(() => expect(client.signInWithPasskeyOnly).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
  });

  test("asks for an emailed link and says the same thing whoever it is for", async () => {
    client.requestSignInLink.mockResolvedValue({ ok: true });
    await renderPasswordless();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await waitFor(() => expect(client.requestSignInLink).toHaveBeenCalledWith("a@example.test"));
    expect(await screen.findByText(/If that email has an account/)).toBeInTheDocument();
  });

  test("hides the passkey button where the browser can't do passkeys, leaving the emailed link", async () => {
    client.browserSupportsWebAuthn.mockReturnValue(false);
    await renderPasswordless();
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
  });
});

describe("Forgot your password?", () => {
  const renderLogin = () =>
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

  test("is offered when the site can email a link", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passwordReset: true });
    renderLogin();
    const link = await screen.findByRole("link", { name: "Forgot your password?" });
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  test("is not offered when it can't (email off, a demo, or passwordless)", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passwordReset: false });
    renderLogin();
    await screen.findByLabelText("Password");
    await waitFor(() => expect(client.fetchSetupStatus).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Forgot your password?" })).not.toBeInTheDocument();
  });
});
