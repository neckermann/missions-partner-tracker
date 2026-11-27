import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  login,
  verifyMfaLogin,
  startForcedMfaSetup,
  confirmForcedMfaSetup,
  fetchSetupStatus,
  loginWithPasskey,
  registerPasskey,
  browserSupportsWebAuthn,
  signInWithPasskeyOnly,
  signInWithPasskeyAutofill,
  browserSupportsWebAuthnAutofill,
  requestSignInLink,
} from "../api/client.js";
import MfaAppGuide from "../components/MfaAppGuide.jsx";
import CopyButton from "../components/shared/CopyButton.jsx";
import RecoveryCodesPanel from "../components/RecoveryCodesPanel.jsx";
import { passkeyErrorMessage } from "../utils/passkeyError.js";

// Where to land after login. `next` (from requireAuth's redirect, an /api path) and `from` (from
// RequireAdminAuth, an SPA route) round-trip through the URL/state, so both are validated here
// to rule out an open redirect via a crafted /login?next=https://evil.com link.
function resolveDestination(location) {
  const next = new URLSearchParams(location.search).get("next");
  if (next && next.startsWith("/api/") && !next.includes("://") && !next.startsWith("//")) {
    return { type: "full", target: next };
  }
  const from = location.state?.from;
  if (typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && !from.includes("://")) {
    return { type: "spa", target: from };
  }
  return { type: "spa", target: "/admin" };
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingToken, setPendingToken] = useState(null);
  const [methods, setMethods] = useState({ authenticatorApp: true, passkey: false });
  const [mfaCode, setMfaCode] = useState("");
  const [setupToken, setSetupToken] = useState(null);
  const [setupData, setSetupData] = useState(null); // { secret, qrCode }
  // Recovery codes handed out right after enrolment; the screen waits until they are saved.
  const [newCodes, setNewCodes] = useState(null);
  // The second step is a one-time recovery code instead of an authenticator code.
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  // The church signs in without passwords.
  const [passwordless, setPasswordless] = useState(false);
  // The church allows passkey sign-in, so the password form also offers "Sign in with a passkey".
  const [passkeySignIn, setPasskeySignIn] = useState(false);
  // "Forgot your password?" is offered when the site can email a link (never on a demo).
  const [canReset, setCanReset] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  // The sign-in page is two short steps: the email (with the passkey button and the browser's own passkey list), then
  // the password, or for a passwordless church the emailed link. Nothing is looked up between them, so the page never
  // says whether an email has an account.
  const [step, setStep] = useState("email"); // "email" | "password"
  const [passkeyNote, setPasskeyNote] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  function goToDestination() {
    const dest = resolveDestination(location);
    // `next` is a raw /api path, not an SPA route -- navigate() can't match
    // it against any <Route>, so it needs a real browser navigation, this
    // time with the fresh session cookie attached.
    if (dest.type === "full") window.location.href = dest.target;
    else navigate(dest.target);
  }

  useEffect(() => {
    // A fresh instance has no admin account yet — send it to account
    // creation instead of a login form nobody can use. Fails open (stays
    // on the login form) if the check itself errors.
    fetchSetupStatus()
      .then((status) => {
        if (status.needed) navigate("/setup", { replace: true });
        setPasswordless(status.passwordless === true);
        setPasskeySignIn(status.passkeySignIn === true);
        setCanReset(status.passwordReset === true);
      })
      .catch(() => {});
  }, [navigate]);

  // Arriving from the emailed sign-in link: its result (a second step, or enrolment to finish) is
  // handled exactly as if a password had just been checked.
  useEffect(() => {
    const resume = location.state?.resume;
    if (resume) applyLoginResult(resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyLoginResult(result) {
    if (result.mfaRequired) {
      setPendingToken(result.pendingToken);
      setMethods(result.methods || { authenticatorApp: true, passkey: false });
    } else if (result.mfaSetupRequired) {
      setSetupToken(result.setupToken);
      setSetupData(await startForcedMfaSetup(result.setupToken));
    } else {
      goToDestination();
    }
  }

  async function handleLocalLogin(e) {
    e.preventDefault();
    setError("");
    try {
      await applyLoginResult(await login(email, password));
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  }

  async function handlePasskeyOnly() {
    setError("");
    setPasskeyNote("");
    try {
      await signInWithPasskeyOnly();
      goToDestination();
    } catch (err) {
      if (err.name === "NotAllowedError") {
        // The browser says the same whether the person cancelled or this device holds no passkey for the site, and so do
        // we: the message depends on nothing about any account.
        setPasskeyNote(
          "That was cancelled, or this device has no passkey for this site. Use your email below instead."
        );
        return;
      }
      setError(
        err.response?.data?.error ||
          (passwordless
            ? "That passkey didn't work. Try again, or use an emailed link."
            : "That passkey didn't work. Try again, or use your password.")
      );
    }
  }

  // Passkey autofill: the browser lists this device's passkeys under the email box, and picking one signs in.
  useEffect(() => {
    if (!passkeySignIn || step !== "email" || !browserSupportsWebAuthn()) return undefined;
    let stopped = false;
    browserSupportsWebAuthnAutofill()
      .then((ok) => (ok && !stopped ? signInWithPasskeyAutofill() : null))
      .then((result) => {
        if (result && !stopped) goToDestination();
      })
      .catch(() => {
        // Cancelled by another passkey request, or nothing picked: the normal page carries on.
      });
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once per visit to the email step
  }, [passkeySignIn, step]);

  function handleContinue(e) {
    e.preventDefault();
    setError("");
    if (passwordless) {
      handleEmailLink(e);
      setStep("password");
    } else {
      setStep("password");
    }
  }

  async function handleEmailLink(e) {
    e.preventDefault();
    setError("");
    try {
      await requestSignInLink(email);
      setLinkSent(true);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't send a link. Try again in a moment.");
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await verifyMfaLogin(pendingToken, mfaCode, { recovery: useRecovery });
      goToDestination();
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    }
  }

  // The second step with a passkey, or finishing forced enrolment with one.
  async function handlePasskeySignIn() {
    setError("");
    try {
      await loginWithPasskey(pendingToken);
      goToDestination();
    } catch (err) {
      setError(err.response?.data?.error || "That passkey didn't work. Try again, or use another method.");
    }
  }

  async function handlePasskeyEnrol() {
    setError("");
    try {
      await registerPasskey("", setupToken);
      goToDestination();
    } catch (err) {
      setError(`${passkeyErrorMessage(err, "Couldn't add a passkey")} Or use an authenticator app instead.`);
    }
  }

  async function handleSetupConfirm(e) {
    e.preventDefault();
    setError("");
    try {
      const result = await confirmForcedMfaSetup(setupToken, mfaCode);
      // The session is already open; hold on this screen until the person has saved their codes.
      if (result?.recoveryCodes?.length) setNewCodes(result.recoveryCodes);
      else goToDestination();
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    }
  }

  if (newCodes) {
    return (
      <div className="admin-shell" style={{ maxWidth: 480 }}>
        <RecoveryCodesPanel codes={newCodes} onDone={goToDestination} doneLabel="Continue to the site" />
      </div>
    );
  }

  if (setupToken) {
    return (
      <div className="admin-shell" style={{ maxWidth: 480 }}>
        <h2>Two-Factor Setup Required</h2>
        <p style={{ color: "var(--muted)" }}>
          An administrator requires two-factor authentication on this account. Follow the steps below to
          finish signing in.
        </p>
        {browserSupportsWebAuthn() && (
          <div style={{ marginBottom: "1rem" }}>
            <p style={{ color: "var(--muted)" }}>
              The simplest way is a passkey: your fingerprint, face or screen lock on this device.
            </p>
            <button type="button" className="btn" onClick={handlePasskeyEnrol}>
              Use a passkey
            </button>
            <p style={{ color: "var(--muted)", marginTop: "1rem" }}>Or use an authenticator app:</p>
          </div>
        )}
        <MfaAppGuide />
        {setupData && (
          <form
            onSubmit={handleSetupConfirm}
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <img src={setupData.qrCode} alt="MFA QR code" style={{ width: 200, height: 200 }} />
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Can't scan it? Enter this code manually: <code>{setupData.secret}</code>{" "}
              <CopyButton text={setupData.secret} label="Copy the setup key" />
            </p>
            <label>
              Code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                autoFocus
                required
              />
            </label>
            {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
            <button type="submit" className="btn">
              Confirm & Sign In
            </button>
          </form>
        )}
      </div>
    );
  }

  if (pendingToken) {
    const canUsePasskey = methods.passkey && browserSupportsWebAuthn();
    const backToLogin = (
      <button
        type="button"
        className="btn secondary"
        onClick={() => {
          setPendingToken(null);
          setUseRecovery(false);
          setMfaCode("");
          setError("");
        }}
      >
        Back to login
      </button>
    );
    return (
      <div className="admin-shell" style={{ maxWidth: 400 }}>
        <h2>Two-Factor Verification</h2>
        {canUsePasskey && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
            <p style={{ color: "var(--muted)" }}>Use the passkey on this device or a security key.</p>
            <button type="button" className="btn" onClick={handlePasskeySignIn}>
              Use a passkey
            </button>
            {methods.authenticatorApp && <p style={{ color: "var(--muted)" }}>Or enter a code instead:</p>}
          </div>
        )}
        {methods.passkey && !canUsePasskey && !methods.authenticatorApp && (
          <p style={{ color: "var(--muted)" }}>
            This browser can't use passkeys. Try another browser or device, or ask an admin to reset your
            two-factor.
          </p>
        )}
        {methods.authenticatorApp && (
          <>
            {!canUsePasskey && (
              <p style={{ color: "var(--muted)" }}>
                {useRecovery
                  ? "Enter one of your recovery codes. It works once."
                  : "Enter the 6-digit code from your authenticator app."}
              </p>
            )}
            <form
              onSubmit={handleMfaSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <label>
                Code
                <input
                  type="text"
                  inputMode={useRecovery ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  maxLength={useRecovery ? 14 : 6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  autoFocus={!canUsePasskey}
                  required
                />
              </label>
              {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
              <button type="submit" className="btn">
                Verify
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setMfaCode("");
                  setError("");
                }}
              >
                {useRecovery ? "Use my authenticator app instead" : "I lost my phone: use a recovery code"}
              </button>
              {backToLogin}
            </form>
          </>
        )}
        {!methods.authenticatorApp && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
            {backToLogin}
          </div>
        )}
      </div>
    );
  }

  const showPasskey = passkeySignIn && browserSupportsWebAuthn();
  const notice = typeof location.state?.notice === "string" && (
    <p role="status" style={{ color: "var(--muted)" }}>
      {location.state.notice}
    </p>
  );
  const useAnother = (
    <button
      type="button"
      onClick={() => {
        setStep("email");
        setPassword("");
        setLinkSent(false);
        setError("");
      }}
      style={{
        background: "none",
        border: 0,
        padding: 0,
        color: "var(--accent, #2F5D8C)",
        textDecoration: "underline",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      Use a different email, or a passkey
    </button>
  );

  // Step 2 on a passwordless church: the same reply for any address.
  if (step === "password" && passwordless) {
    return (
      <div className="admin-shell" style={{ maxWidth: 400 }}>
        <h2>Check your email</h2>
        {linkSent ? (
          <p role="status">
            If {email} has an account here, a sign-in link is on its way. It works once and expires in 15
            minutes.
          </p>
        ) : (
          <p role="status">Sending…</p>
        )}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        {useAnother}
      </div>
    );
  }

  // Step 2: the password.
  if (step === "password") {
    return (
      <div className="admin-shell" style={{ maxWidth: 400 }}>
        <h2>Enter your password</h2>
        <p style={{ color: "var(--muted)" }}>{email}</p>
        <form
          onSubmit={handleLocalLogin}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button type="submit" className="btn">
            Sign in
          </button>
          {canReset && (
            <p style={{ margin: 0, fontSize: "0.9rem" }}>
              <Link to="/forgot-password">Forgot your password?</Link>
            </p>
          )}
          {!canReset && (
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)" }}>
              Forgot your password? Ask an administrator to set a new one for you.
            </p>
          )}
          {useAnother}
        </form>
      </div>
    );
  }

  // Step 1: the passkey button first, then the email.
  return (
    <div className="admin-shell" style={{ maxWidth: 400 }}>
      <h2>Team Login</h2>
      {notice}
      {showPasskey && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
          <button type="button" className="btn" onClick={handlePasskeyOnly}>
            Sign in with a passkey
          </button>
          {passkeyNote && (
            <p role="status" style={{ margin: 0, color: "var(--muted)" }}>
              {passkeyNote}
            </p>
          )}
          <p style={{ margin: 0, color: "var(--muted)" }}>or use your email</p>
        </div>
      )}
      <form onSubmit={handleContinue} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit" className={showPasskey ? "btn secondary" : "btn"}>
          Continue
        </button>
      </form>
    </div>
  );
}
