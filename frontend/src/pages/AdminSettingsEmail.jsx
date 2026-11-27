import React, { useEffect, useState } from "react";
import { fetchEmailSettings, updateEmailSettings, sendTestEmail } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";

// Sending and receiving both go through Postmark but are gated by two independent flags
// ("outboundEmail" / "inboundEmail"), so each is its own EditableSection card saved as an
// independent partial update. See ADMIN_GUIDE.md § Email (Postmark).
export default function AdminSettingsEmail() {
  const { refreshSettings } = useSettings();
  const [settings, setSettings] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [loadError, setLoadError] = useState("");

  async function reload() {
    const s = await fetchEmailSettings();
    setSettings(s);
  }

  useEffect(() => {
    reload().catch(() => setLoadError("Couldn't load email settings."));
  }, []);

  async function saveSend(draft) {
    const updated = await updateEmailSettings({
      sendEnabled: draft.sendEnabled,
      ...(draft.serverToken?.trim() ? { serverToken: draft.serverToken.trim() } : {}),
      fromAddress: draft.fromAddress?.trim() || null,
    });
    setSettings(updated);
    // The sidebar's Email link visibility depends on sendEnabled (see refreshSettings in SettingsContext.jsx).
    refreshSettings();
  }

  async function saveReceive(draft) {
    const updated = await updateEmailSettings({
      receiveEnabled: draft.receiveEnabled,
      ...(draft.webhookUsername?.trim() ? { webhookUsername: draft.webhookUsername.trim() } : {}),
      ...(draft.webhookPassword?.trim() ? { webhookPassword: draft.webhookPassword.trim() } : {}),
      inboundEmailAddress: draft.inboundEmailAddress?.trim() || null,
      skipReview: draft.skipReview,
    });
    setSettings(updated);
    // The sidebar's Email link and the "Unmatched Emails" nav depend on receiveEnabled (see refreshSettings).
    refreshSettings();
  }

  async function handleTestSend() {
    setTesting(true);
    setTestResult("");
    try {
      await sendTestEmail();
      setTestResult("Test email sent -- check your inbox.");
    } catch (err) {
      setTestResult(err.response?.data?.error || "Couldn't send a test email.");
    } finally {
      setTesting(false);
    }
  }

  if (loadError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="Email" />
        <p className="form-error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }
  if (!settings) return <p className="admin-shell">Loading…</p>;

  const webhookUrl = window.location.origin + (settings.webhookPath || "");

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="Email" />
      <p style={{ color: "var(--muted)" }}>
        Sends and receives email through{" "}
        <a href="https://postmarkapp.com" target="_blank" rel="noreferrer">
          Postmark
        </a>
        , a dedicated email service — not through this church's own Gmail/Microsoft account. See{" "}
        <a
          href="https://missionspartnertracker.com/admin-guide.html#email-postmark"
          target="_blank"
          rel="noreferrer"
        >
          Admin Guide § Email (Postmark)
        </a>{" "}
        for the full setup. Sending and receiving are independent — turn on just the one you use.
      </p>

      <EditableSection
        title="Sending"
        value={{
          sendEnabled: settings.sendEnabled,
          serverToken: "",
          fromAddress: settings.fromAddress || "",
        }}
        onSave={saveSend}
        onSaved={reload}
        actions={
          <>
            <button
              type="button"
              className="btn secondary small"
              onClick={handleTestSend}
              disabled={testing || !settings.outboundConfigured}
            >
              {testing ? "Sending..." : "Send Test Email"}
            </button>
          </>
        }
        view={(v) => (
          <>
            <p>
              <strong>{v.sendEnabled ? "Enabled" : "Disabled"}</strong>
              {settings.outboundConfigured ? " · Configured" : " · Not configured"}
            </p>
            {v.sendEnabled && !settings.outboundConfigured && (
              <p role="status" style={{ color: "var(--warn)" }}>
                Email isn't finished setting up. Until a mail account and From address are saved below,
                nothing is emailed: the app shows a link to copy instead (new users, setup links) and the
                public Subscribe form says it isn't available.
              </p>
            )}
            <p style={{ color: "var(--muted)" }}>From: {v.fromAddress || "Not set"}</p>
            {testResult && <p style={{ color: "var(--muted)" }}>{testResult}</p>}
          </>
        )}
        edit={(d, set) => (
          <>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={d.sendEnabled}
                  onChange={(e) => set("sendEnabled", e.target.checked)}
                />
                Enabled
              </label>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
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
                value={d.serverToken}
                onChange={(e) => set("serverToken", e.target.value)}
                placeholder={
                  settings.outboundConfigured
                    ? "Configured — leave blank to keep it"
                    : "Paste your server API token"
                }
                autoComplete="off"
              />
            </label>
            <label style={{ marginTop: "1rem" }}>
              From Address
              <input
                value={d.fromAddress}
                onChange={(e) => set("fromAddress", e.target.value)}
                placeholder="updates@yourchurch.org"
              />
            </label>
          </>
        )}
      />

      <div style={{ marginTop: "1rem" }}>
        <EditableSection
          title="Receiving"
          value={{
            receiveEnabled: settings.receiveEnabled,
            webhookUsername: settings.webhookUsername || "",
            webhookPassword: "",
            inboundEmailAddress: settings.inboundEmailAddress || "",
            skipReview: settings.skipReview === true,
          }}
          onSave={saveReceive}
          onSaved={reload}
          view={(v) => (
            <>
              <p>
                <strong>{v.receiveEnabled ? "Enabled" : "Disabled"}</strong>
                {settings.inboundConfigured ? " · Configured" : " · Not configured"}
              </p>
              <p style={{ color: "var(--muted)" }}>Webhook username: {v.webhookUsername || "Not set"}</p>
              <p style={{ color: "var(--muted)" }}>Inbound address: {v.inboundEmailAddress || "Not set"}</p>
              <p style={{ color: "var(--muted)" }}>
                {v.skipReview
                  ? "Mail from a partner's own address that passes the sender check is filed and announced without review. Everything else waits in Emails to sort."
                  : "Every message waits in Emails to sort until someone files it."}
              </p>
              <code
                style={{
                  display: "block",
                  padding: "0.5rem",
                  background: "var(--surface-2)",
                  wordBreak: "break-all",
                }}
              >
                https://{"<username>"}:{"<password>"}@{webhookUrl.replace(/^https?:\/\//, "")}
              </code>
            </>
          )}
          edit={(d, set) => (
            <>
              <div className="admin-checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={d.receiveEnabled}
                    onChange={(e) => set("receiveEnabled", e.target.checked)}
                  />
                  Enabled
                </label>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                Lets partners email updates straight into this app — every message waits in the{" "}
                <strong>Emails to sort</strong> list until an admin or editor files it (a match against a
                partner's own email, or any of their household adults', is noted there). On your Postmark
                server's Inbound stream Settings tab, check{" "}
                <strong>Include raw email content in JSON payload</strong>, then set the{" "}
                <strong>Inbound webhook</strong> URL to the address shown below, using the username/password
                you choose here -- Postmark sends them as HTTP Basic Auth on every request. Pick any dedicated
                subdomain for partners to send to (never the church's own real inbox).
              </p>
              <code
                style={{
                  display: "block",
                  padding: "0.5rem",
                  background: "var(--surface-2)",
                  wordBreak: "break-all",
                }}
              >
                https://{"<username>"}:{"<password>"}@{webhookUrl.replace(/^https?:\/\//, "")}
              </code>
              <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
                <label>
                  <input
                    type="checkbox"
                    checked={d.skipReview}
                    onChange={(e) => set("skipReview", e.target.checked)}
                  />
                  File mail from a verified partner without review
                </label>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                Off by default. When on, a message whose sender address matches exactly one partner{" "}
                <em>and</em> passes the sender check (SPF or DKIM) is filed as that partner's newsletter and
                announced straight away, with nobody looking at it first. A sender address can be forged, so
                leave this off unless you are comfortable with that. Anything that does not match, matches
                more than one partner, or fails the check still waits in Emails to sort.
              </p>
              <label style={{ marginTop: "1rem" }}>
                Webhook Username
                <input
                  value={d.webhookUsername}
                  onChange={(e) => set("webhookUsername", e.target.value)}
                  placeholder="Choose a username"
                  autoComplete="off"
                />
              </label>
              <label style={{ marginTop: "1rem" }}>
                Webhook Password
                <input
                  type="password"
                  value={d.webhookPassword}
                  onChange={(e) => set("webhookPassword", e.target.value)}
                  placeholder={
                    settings.inboundConfigured ? "Configured — leave blank to keep it" : "Choose a password"
                  }
                  autoComplete="off"
                />
              </label>
              <label style={{ marginTop: "1rem" }}>
                Inbound Email Address
                <input
                  value={d.inboundEmailAddress}
                  onChange={(e) => set("inboundEmailAddress", e.target.value)}
                  placeholder="updates@mail.yourchurch.org"
                />
              </label>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                The address partners were told (outside this app) to send their newsletters/updates to, on
                whatever inbound domain you configured in Postmark above -- purely informational, doesn't
                change the webhook itself.
              </p>
            </>
          )}
        />
      </div>
    </div>
  );
}
