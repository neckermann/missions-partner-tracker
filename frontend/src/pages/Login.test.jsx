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
  signInWithPasskeyAutofill: vi.fn(),
  browserSupportsWebAuthnAutofill: vi.fn().mockResolvedValue(false),
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
  // Two short steps: the email, then the password.
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  client.browserSupportsWebAuthn.mockReturnValue(true);
  client.fetchSetupStatus.mockResolvedValue({ needed: false });
  client.browserSupportsWebAuthnAutofill.mockResolvedValue(false);
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

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
const typeEmailAndContinue = (email = "a@example.test") => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
};

describe("the sign-in page: the passkey first, then the email", () => {
  test("the passkey button is first, and signs in with it alone", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: true });
    client.signInWithPasskeyOnly.mockResolvedValue({ user: {} });
    renderLogin();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
    await waitFor(() => expect(client.signInWithPasskeyOnly).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
  });

  test("a device with no passkey (or a cancelled prompt) gets one plain message pointing to the email box", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: true });
    client.signInWithPasskeyOnly.mockRejectedValue({ name: "NotAllowedError" });
    renderLogin();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
    expect(await screen.findByText(/no passkey for this site/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("the browser's own passkey list starts when it can, and signing in with one goes on to the site", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: true });
    client.browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    client.signInWithPasskeyAutofill.mockResolvedValue({ user: {} });
    renderLogin();
    await waitFor(() => expect(client.signInWithPasskeyAutofill).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username webauthn");
  });

  test("the passkey button is not shown where the server doesn't offer it (a demo) or the browser can't", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: false });
    const { unmount } = renderLogin();
    await screen.findByLabelText("Email");
    await waitFor(() => expect(client.fetchSetupStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
    unmount();
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: true });
    client.browserSupportsWebAuthn.mockReturnValue(false);
    renderLogin();
    await screen.findByLabelText("Email");
    await waitFor(() => expect(client.fetchSetupStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
    client.browserSupportsWebAuthn.mockReturnValue(true);
  });

  test("Continue goes straight to the password for any email, looking nothing up", async () => {
    renderLogin();
    await screen.findByLabelText("Email");
    typeEmailAndContinue("anyone@example.test");
    expect(await screen.findByRole("heading", { name: "Enter your password" })).toBeInTheDocument();
    expect(screen.getByText("anyone@example.test")).toBeInTheDocument();
    // Nothing was sent to the server by the email step.
    expect(client.login).not.toHaveBeenCalled();
    expect(client.requestSignInLink).not.toHaveBeenCalled();
    // And there is no passkey button on the password page.
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
  });

  test("'Use a different email, or a passkey' goes back to the first step", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passkeySignIn: true });
    renderLogin();
    await screen.findByLabelText("Email");
    typeEmailAndContinue();
    fireEvent.click(await screen.findByRole("button", { name: "Use a different email, or a passkey" }));
    expect(await screen.findByRole("button", { name: "Sign in with a passkey" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("passwordless sign-in (#386 Layer 2)", () => {
  async function renderPasswordless() {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: true, passkeySignIn: true });
    renderLogin();
    await screen.findByRole("button", { name: "Continue" });
  }

  test("offers a passkey first and an email, not a password", async () => {
    await renderPasswordless();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sign in with a passkey" })).toBeInTheDocument();
  });

  test("signs in with a passkey alone", async () => {
    client.signInWithPasskeyOnly.mockResolvedValue({ user: {} });
    await renderPasswordless();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with a passkey" }));
    await waitFor(() => expect(client.signInWithPasskeyOnly).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
  });

  test("Continue asks for an emailed link and says the same thing whoever it is for", async () => {
    client.requestSignInLink.mockResolvedValue({ ok: true });
    await renderPasswordless();
    typeEmailAndContinue();
    await waitFor(() => expect(client.requestSignInLink).toHaveBeenCalledWith("a@example.test"));
    expect(await screen.findByText(/has an account here, a sign-in link is on its way/)).toBeInTheDocument();
  });

  test("hides the passkey button where the browser can't do passkeys, leaving the email", async () => {
    client.browserSupportsWebAuthn.mockReturnValue(false);
    await renderPasswordless();
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("Forgot your password?", () => {
  test("is offered on the password page when the site can email a link", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passwordReset: true });
    renderLogin();
    await screen.findByLabelText("Email");
    await waitFor(() => expect(client.fetchSetupStatus).toHaveBeenCalled());
    typeEmailAndContinue();
    const link = await screen.findByRole("link", { name: "Forgot your password?" });
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  test("a site that can't email says to ask an administrator instead (email off, a demo)", async () => {
    client.fetchSetupStatus.mockResolvedValue({ needed: false, passwordless: false, passwordReset: false });
    renderLogin();
    await screen.findByLabelText("Email");
    await waitFor(() => expect(client.fetchSetupStatus).toHaveBeenCalled());
    typeEmailAndContinue();
    await screen.findByLabelText("Password");
    expect(screen.queryByRole("link", { name: "Forgot your password?" })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an administrator to set a new one/)).toBeInTheDocument();
  });
});

describe("recovery codes", () => {
  test("a lost phone: the second step can take a recovery code instead", async () => {
    client.login.mockResolvedValue({
      mfaRequired: true,
      pendingToken: "t",
      methods: { authenticatorApp: true, passkey: false },
    });
    client.verifyMfaLogin.mockResolvedValue({ user: {} });
    await signIn();
    fireEvent.click(await screen.findByRole("button", { name: "I lost my phone: use a recovery code" }));
    expect(screen.getByText(/Enter one of your recovery codes/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "abcde-fghjk" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(client.verifyMfaLogin).toHaveBeenCalledWith("t", "abcde-fghjk", { recovery: true })
    );
  });

  test("an authenticator code is still sent as a code", async () => {
    client.login.mockResolvedValue({
      mfaRequired: true,
      pendingToken: "t",
      methods: { authenticatorApp: true, passkey: false },
    });
    client.verifyMfaLogin.mockResolvedValue({ user: {} });
    await signIn();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(client.verifyMfaLogin).toHaveBeenCalledWith("t", "123456", { recovery: false })
    );
  });

  test("after first-time setup the codes are shown and the way on waits until they are saved", async () => {
    client.login.mockResolvedValue({ mfaSetupRequired: true, setupToken: "s" });
    client.startForcedMfaSetup.mockResolvedValue({ secret: "SECRET", qrCode: "data:image/png;base64,x" });
    client.confirmForcedMfaSetup.mockResolvedValue({
      user: {},
      recoveryCodes: ["aaaaa-bbbbb", "ccccc-ddddd"],
    });
    await signIn();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Sign In" }));
    expect(await screen.findByText("aaaaa-bbbbb")).toBeInTheDocument();
    const go = screen.getByRole("button", { name: "Continue to the site" });
    expect(go).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/I have saved these codes/));
    expect(go).toBeEnabled();
    fireEvent.click(go);
    expect(navigate).toHaveBeenCalled();
  });
});
