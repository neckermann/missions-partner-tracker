import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  login,
  verifyMfaLogin,
  startForcedMfaSetup,
  confirmForcedMfaSetup,
  fetchSetupStatus,
  loginWithPasskey,
  registerPasskey,
  browserSupportsWebAuthn,
} from "../api/client.js";
import MfaAppGuide from "../components/MfaAppGuide.jsx";

// #124: where to land after a successful login, instead of always /admin.
// `next` is set by requireAuth's own redirect (a cold click on a direct
// link to a file, e.g. from a GroupMe notification) and is always a
// same-origin /api path server-side -- but it round-trips through the URL
// bar, so it's treated as untrusted here anyway. `from` is set by
// RequireAdminAuth (a session that expired mid-visit) and is always an SPA
// route. Both are validated before use to rule out an open redirect via a
// crafted /login?next=https://evil.com link.
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
  const [error, setError] = useState("");
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
      })
      .catch(() => {});
  }, [navigate]);

  async function handleLocalLogin(e) {
    e.preventDefault();
    setError("");
    try {
      const result = await login(email, password);
      if (result.mfaRequired) {
        setPendingToken(result.pendingToken);
        setMethods(result.methods || { authenticatorApp: true, passkey: false });
      } else if (result.mfaSetupRequired) {
        setSetupToken(result.setupToken);
        setSetupData(await startForcedMfaSetup(result.setupToken));
      } else {
        goToDestination();
      }
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await verifyMfaLogin(pendingToken, mfaCode);
      goToDestination();
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    }
  }

  // #386: the second step with a passkey, or finishing forced enrolment with one.
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
      setError(
        err.response?.data?.error || "Couldn't add a passkey. Try again, or use an authenticator app."
      );
    }
  }

  async function handleSetupConfirm(e) {
    e.preventDefault();
    setError("");
    try {
      await confirmForcedMfaSetup(setupToken, mfaCode);
      goToDestination();
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    }
  }

  if (setupToken) {
    return (
      <div className="admin-shell" style={{ maxWidth: 480 }}>
        <h2>Two-Factor Setup Required</h2>
        <p style={{ color: "#555" }}>
          An administrator requires two-factor authentication on this account. Follow the steps below to
          finish signing in.
        </p>
        {browserSupportsWebAuthn() && (
          <div style={{ marginBottom: "1rem" }}>
            <p style={{ color: "#555" }}>
              The simplest way is a passkey: your fingerprint, face or screen lock on this device.
            </p>
            <button type="button" className="btn" onClick={handlePasskeyEnrol}>
              Use a passkey
            </button>
            <p style={{ color: "#555", marginTop: "1rem" }}>Or use an authenticator app:</p>
          </div>
        )}
        <MfaAppGuide />
        {setupData && (
          <form
            onSubmit={handleSetupConfirm}
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <img src={setupData.qrCode} alt="MFA QR code" style={{ width: 200, height: 200 }} />
            <p style={{ fontSize: "0.85rem", color: "#555" }}>
              Can't scan it? Enter this code manually: <code>{setupData.secret}</code>
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
            {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
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
            <p style={{ color: "#555" }}>Use the passkey on this device or a security key.</p>
            <button type="button" className="btn" onClick={handlePasskeySignIn}>
              Use a passkey
            </button>
            {methods.authenticatorApp && <p style={{ color: "#555" }}>Or enter a code instead:</p>}
          </div>
        )}
        {methods.passkey && !canUsePasskey && !methods.authenticatorApp && (
          <p style={{ color: "#555" }}>
            This browser can't use passkeys. Try another browser or device, or ask an admin to reset your
            two-factor.
          </p>
        )}
        {methods.authenticatorApp && (
          <>
            {!canUsePasskey && (
              <p style={{ color: "#555" }}>Enter the 6-digit code from your authenticator app.</p>
            )}
            <form
              onSubmit={handleMfaSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <label>
                Code
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  autoFocus={!canUsePasskey}
                  required
                />
              </label>
              {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
              <button type="submit" className="btn">
                Verify
              </button>
              {backToLogin}
            </form>
          </>
        )}
        {!methods.authenticatorApp && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
            {backToLogin}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="admin-shell" style={{ maxWidth: 400 }}>
      <h2>Team Login</h2>
      {typeof location.state?.notice === "string" && (
        <p role="status" style={{ color: "#555" }}>
          {location.state.notice}
        </p>
      )}

      <form onSubmit={handleLocalLogin} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        <button type="submit" className="btn">
          Sign in
        </button>
      </form>
    </div>
  );
}
