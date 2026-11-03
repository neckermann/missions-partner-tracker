import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  login,
  verifyMfaLogin,
  startForcedMfaSetup,
  confirmForcedMfaSetup,
  fetchSetupStatus,
} from "../api/client.js";

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
      <div className="admin-shell" style={{ maxWidth: 400 }}>
        <h2>Two-Factor Setup Required</h2>
        <p style={{ color: "#555" }}>
          An administrator requires two-factor authentication on this account. Scan this QR code with an
          authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code it shows to
          finish signing in.
        </p>
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
    return (
      <div className="admin-shell" style={{ maxWidth: 400 }}>
        <h2>Two-Factor Verification</h2>
        <p style={{ color: "#555" }}>Enter the 6-digit code from your authenticator app.</p>
        <form onSubmit={handleMfaSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
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
            Verify
          </button>
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
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell" style={{ maxWidth: 400 }}>
      <h2>Team Login</h2>

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
