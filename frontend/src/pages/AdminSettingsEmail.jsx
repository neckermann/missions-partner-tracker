import React, { useEffect, useState } from "react";
import { fetchEmailSettings, updateEmailSettings, sendTestEmail } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";

// Sending (#71) and receiving (#72) email both go through Postmark -- one
// account, one settings page -- but are gated by two independent Enabled
// Features flags ("outboundEmail" / "inboundEmail"), not one. A church
// can run just one direction, so each section below has its own
// "Enabled" checkbox and its own Save, submitted as independent partial
// updates against the same PUT endpoint -- saving one section never
// touches the other's fields. See ADMIN_GUIDE.md § Email (Postmark) for
// why Postmark over SMTP/direct-send, and for the full setup walkthrough.
export default function AdminSettingsEmail() {
  const { refreshSettings } = useSettings();
  const [sendEnabled, setSendEnabled] = useState(false);
  const [outboundConfigured, setOutboundConfigured] = useState(false);
  const [fromAddress, setFromAddress] = useState("");
  const [serverToken, setServerToken] = useState("");

  const [receiveEnabled, setReceiveEnabled] = useState(false);
  const [inboundConfigured, setInboundConfigured] = useState(false);
  const [webhookUsername, setWebhookUsername] = useState("");
  const [webhookPassword, setWebhookPassword] = useState("");
  const [webhookPath, setWebhookPath] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingSend, setSavingSend] = useState(false);
  const [savingReceive, setSavingReceive] = useState(false);
  const [testing, setTesting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  function applySettings(s) {
    setSendEnabled(s.sendEnabled);
    setOutboundConfigured(s.outboundConfigured);
    setFromAddress(s.fromAddress || "");
    setReceiveEnabled(s.receiveEnabled);
    setInboundConfigured(s.inboundConfigured);
    setWebhookUsername(s.webhookUsername || "");
    setWebhookPath(s.webhookPath || "");
  }

  useEffect(() => {
    fetchEmailSettings()
      .then(applySettings)
      .catch((err) => setError(err.response?.data?.error || "Couldn't load email settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveSend(e) {
    e.preventDefault();
    setSavingSend(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateEmailSettings({
        sendEnabled,
        ...(serverToken.trim() ? { serverToken: serverToken.trim() } : {}),
        fromAddress: fromAddress.trim() || null,
      });
      applySettings(updated);
      setServerToken("");
      // See SettingsContext.jsx's refreshSettings comment -- the sidebar's
      // Email link visibility depends on this same sendEnabled flag.
      refreshSettings();
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save sending settings.");
    } finally {
      setSavingSend(false);
    }
  }

  async function handleSaveReceive(e) {
    e.preventDefault();
    setSavingReceive(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateEmailSettings({
        receiveEnabled,
        ...(webhookUsername.trim() ? { webhookUsername: webhookUsername.trim() } : {}),
        ...(webhookPassword.trim() ? { webhookPassword: webhookPassword.trim() } : {}),
      });
      applySettings(updated);
      setWebhookPassword("");
      // See SettingsContext.jsx's refreshSettings comment -- both the
      // sidebar's Email link and the "Unmatched Emails" nav/tile depend
      // on this same receiveEnabled flag.
      refreshSettings();
      setSuccess("Saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save receiving settings.");
    } finally {
      setSavingReceive(false);
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

  const webhookUrl = window.location.origin + webhookPath;

  return (
    <div className="admin-shell">
      <h2>Email</h2>
      <p style={{ color: "#555" }}>
        Sends and receives email through{" "}
        <a href="https://postmarkapp.com" target="_blank" rel="noreferrer">
          Postmark
        </a>
        , a dedicated email service — not through this church's own Gmail/Microsoft account. See{" "}
        <a
          href="https://github.com/neckermann/missions-partner-tracker/blob/main/ADMIN_GUIDE.md#email-postmark"
          target="_blank"
          rel="noreferrer"
        >
          ADMIN_GUIDE.md § Email (Postmark)
        </a>{" "}
        for the full setup. Sending and receiving are independent — turn on just the one you use.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <form onSubmit={handleSaveSend} className="admin-form">
        <div className="admin-section">
          <h3>Sending</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={sendEnabled}
                onChange={(e) => setSendEnabled(e.target.checked)}
              />
              Enabled
            </label>
          </div>
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
              placeholder={
                outboundConfigured ? "Configured — leave blank to keep it" : "Paste your server API token"
              }
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
            <button type="submit" className="btn" disabled={savingSend}>
              {savingSend ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={handleTestSend}
              disabled={testing || !outboundConfigured}
            >
              {testing ? "Sending..." : "Send Test Email"}
            </button>
          </div>
        </div>
      </form>

      <form onSubmit={handleSaveReceive} className="admin-form" style={{ marginTop: "1.5rem" }}>
        <div className="admin-section">
          <h3>Receiving</h3>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={receiveEnabled}
                onChange={(e) => setReceiveEnabled(e.target.checked)}
              />
              Enabled
            </label>
          </div>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            Lets partners email updates straight into this app — a match against a partner's own email (or any
            of their household adults') files it as a Newsletter automatically; anything else lands in the{" "}
            <strong>Unmatched Emails</strong> queue. On your Postmark server's Inbound stream Settings tab,
            check <strong>Include raw email content in JSON payload</strong>, then set the{" "}
            <strong>Inbound webhook</strong> URL to:
          </p>
          <code
            style={{ display: "block", padding: "0.5rem", background: "#f4f4f4", wordBreak: "break-all" }}
          >
            https://{"<username>"}:{"<password>"}@{webhookUrl.replace(/^https?:\/\//, "")}
          </code>
          <p style={{ color: "#555", fontSize: "0.9rem", marginTop: "0.5rem" }}>
            using the username/password you choose below -- Postmark sends them as HTTP Basic Auth on every
            request. Pick any dedicated subdomain for partners to send to (never the church's own real inbox).
          </p>
          <label>
            Webhook Username
            <input
              value={webhookUsername}
              onChange={(e) => setWebhookUsername(e.target.value)}
              placeholder="Choose a username"
              autoComplete="off"
            />
          </label>
          <label style={{ marginTop: "1rem" }}>
            Webhook Password
            <input
              type="password"
              value={webhookPassword}
              onChange={(e) => setWebhookPassword(e.target.value)}
              placeholder={inboundConfigured ? "Configured — leave blank to keep it" : "Choose a password"}
              autoComplete="off"
            />
          </label>
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={savingReceive}>
              {savingReceive ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
