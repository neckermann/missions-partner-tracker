import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSetupStatus, completeSetup } from "../api/client.js";

// First-run account creation — only ever reachable (and only ever
// succeeds) before this instance has its first admin account. Once one
// exists, GET /auth/setup-status reports needed: false and this page
// redirects straight to /login, same as visiting it a second time.
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
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSaving(true);
    try {
      await completeSetup(email, password);
      navigate("/admin");
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
      <p style={{ color: "#555" }}>
        This is a fresh instance with no admin account yet. Create the first one below — you'll
        be signed in immediately afterward, and can invite others or configure your church's
        branding from the admin dashboard.
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
        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Creating account…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}
