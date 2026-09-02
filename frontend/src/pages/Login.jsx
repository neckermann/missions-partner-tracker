import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  login,
  verifyMfaLogin,
  startForcedMfaSetup,
  confirmForcedMfaSetup,
  fetchSsoProviders,
} from "../api/client.js";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingToken, setPendingToken] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [setupToken, setSetupToken] = useState(null);
  const [setupData, setSetupData] = useState(null); // { secret, qrCode }
  const [ssoProviders, setSsoProviders] = useState([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    fetchSsoProviders().then(setSsoProviders).catch(() => setSsoProviders([]));
    if (searchParams.get("error") === "sso") {
      setError("Single sign-on failed. Try again, or use your email and password below.");
    }
  }, [searchParams]);

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
        navigate("/admin");
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
      navigate("/admin");
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    }
  }

  async function handleSetupConfirm(e) {
    e.preventDefault();
    setError("");
    try {
      await confirmForcedMfaSetup(setupToken, mfaCode);
      navigate("/admin");
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    }
  }

  if (setupToken) {
    return (
      <div className="admin-shell" style={{ maxWidth: 400 }}>
        <h2>Two-Factor Setup Required</h2>
        <p style={{ color: "#555" }}>
          An administrator requires two-factor authentication on this account. Scan this QR
          code with an authenticator app (Google Authenticator, Authy, etc.), then enter the
          6-digit code it shows to finish signing in.
        </p>
        {setupData && (
          <form onSubmit={handleSetupConfirm} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
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
            <button type="submit" className="btn">Confirm & Sign In</button>
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
          <button type="submit" className="btn">Verify</button>
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

      {ssoProviders.map((p) => (
        <a
          key={p.id}
          href={`/api/auth/sso/${p.id}/login`}
          className="btn"
          style={{ display: "block", textAlign: "center", marginBottom: "0.75rem", textDecoration: "none" }}
        >
          Sign in with {p.displayName}
        </a>
      ))}
      {ssoProviders.length > 0 && (
        <div style={{ textAlign: "center", margin: "0.75rem 0", color: "#888" }}>— or —</div>
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
        <button type="submit" className="btn">Sign in</button>
      </form>
    </div>
  );
}
