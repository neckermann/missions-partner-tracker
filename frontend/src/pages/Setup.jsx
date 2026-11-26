import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSetupStatus, completeSetup } from "../api/client.js";
import { passwordsMatch } from "../utils/password.js";

// First-run account creation: only succeeds before the first admin exists; after that
// GET /auth/setup-status reports needed: false and this page redirects to /login.
export default function Setup() {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSetupStatus()
      .then((status) => {
        if (!status.needed) {
          navigate("/login", { replace: true });
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!passwordsMatch(password, confirmPassword)) {
      setError("Passwords don't match");
      return;
    }
    setSaving(true);
    try {
      await completeSetup(email, password);
      // Two-factor is required from the start on a fresh install, so there is no session yet:
      // sign in with the password just chosen and the next step is enrolment.
      navigate("/login", {
        replace: true,
        state: {
          notice:
            "Your admin account is ready. Sign in to finish setting up: you'll be asked to set up two-factor authentication with an authenticator app.",
        },
      });
    } catch (err) {
      setError(err.response?.data?.error || "Setup failed");
    } finally {
      setSaving(false);
    }
  }

  if (checking) return null;

  return (
    <div className="admin-shell" style={{ maxWidth: 420 }}>
      <h2>Welcome</h2>
      <p style={{ color: "var(--muted)" }}>
        This is a fresh instance with no admin account yet. Create the first one below. You'll then sign in
        and set up two-factor authentication (an authenticator app on your phone), which is required for
        everyone on a new install; after that you can invite others and configure your church's branding from
        the admin dashboard.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Creating account…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}
