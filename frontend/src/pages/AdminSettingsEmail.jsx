import React, { useEffect, useState } from "react";
import { fetchEmailSettings, updateEmailSettings, sendTestEmail } from "../api/client.js";

// Outbound email via Postmark (see #71) -- a transactional email provider,
// not SMTP against the church's own Gmail/Microsoft mailbox. See
// ADMIN_GUIDE.md § Email (Postmark) for why. Two fields (server token,
// from address) plus a live test-send, so this follows
// AdminSettingsGroupMe.jsx's template rather than the simpler
// ApiKeySettingsPage.jsx (built for the single-key Joshua Project/AI
// Extraction pair).
export default function AdminSettingsEmail() {
  const [configured, setConfigured] = useState(false);
  const [fromAddress, setFromAddress] = useState("");
  const [serverToken, setServerToken] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchEmailSettings()
      .then((s) => {
        setConfigured(s.configured);
        setFromAddress(s.fromAddress || "");
      })
      .catch((err) => setError(err.response?.data?.error || "Couldn't load email settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateEmailSettings({
        ...(serverToken.trim() ? { serverToken: serverToken.trim() } : {}),
        fromAddress: fromAddress.trim() || null,
      });
      setConfigured(updated.configured);
      setFromAddress(updated.fromAddress || "");
      setServerToken("");
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save email settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend() {
    setTesting(true);
    setSuccess("");
    setError("");
    try {
      await sendTestEmail();
      setSuccess("Test email sent -- check your inbox.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't send a test email.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>Email</h2>
      <p style={{ color: "#555" }}>
        Sends email through{" "}
        <a href="https://postmarkapp.com" target="_blank" rel="noreferrer">
          Postmark
        </a>
        , a dedicated email delivery service — not through this church's own Gmail/Microsoft account. See{" "}
        <a
          href="https://github.com/neckermann/missions-partner-tracker/blob/main/ADMIN_GUIDE.md#email-postmark"
          target="_blank"
          rel="noreferrer"
        >
          ADMIN_GUIDE.md § Email (Postmark)
        </a>{" "}
        for setup and why. Turn this on in <a href="/admin/settings/features">Enabled Features</a> once it's
        configured below.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <form onSubmit={handleSave} className="admin-form">
        <div className="admin-section">
          <h3>Postmark</h3>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            Create a free account at{" "}
            <a href="https://postmarkapp.com" target="_blank" rel="noreferrer">
              postmarkapp.com
            </a>
            , verify a sending domain (adds SPF/DKIM records to your domain's DNS), then copy the{" "}
            <strong>Server API Token</strong> from your server's API Tokens tab.
          </p>
          <label>
            Server API Token
            <input
              type="password"
              value={serverToken}
              onChange={(e) => setServerToken(e.target.value)}
              placeholder={configured ? "Configured — leave blank to keep it" : "Paste your server API token"}
              autoComplete="off"
            />
          </label>
          <label style={{ marginTop: "1rem" }}>
            From Address
            <input
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="updates@yourchurch.org"
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "center" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={handleTestSend}
              disabled={testing || !configured}
            >
              {testing ? "Sending..." : "Send Test Email"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
