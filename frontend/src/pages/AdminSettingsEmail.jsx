import React, { useEffect, useState } from "react";
import { fetchEmailSettings, updateEmailSettings, sendTestEmail } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";

// Sending (#71) and receiving (#72) email both go through Postmark -- one
// account, one settings page -- but are gated by two independent Enabled
// Features flags ("outboundEmail" / "inboundEmail"), not one. A church
// can run just one direction, so each is its own EditableSection card,
// saved as an independent partial update against the same PUT endpoint --
// saving one card never touches the other's fields. See ADMIN_GUIDE.md §
// Email (Postmark) for why Postmark over SMTP/direct-send, and for the
// full setup walkthrough.
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
    // See SettingsContext.jsx's refreshSettings comment -- the sidebar's
    // Email link visibility depends on this same sendEnabled flag.
    refreshSettings();
  }

  async function saveReceive(draft) {
    const updated = await updateEmailSettings({
      receiveEnabled: draft.receiveEnabled,
      ...(draft.webhookUsername?.trim() ? { webhookUsername: draft.webhookUsername.trim() } : {}),
      ...(draft.webhookPassword?.trim() ? { webhookPassword: draft.webhookPassword.trim() } : {}),
      inboundEmailAddress: draft.inboundEmailAddress?.trim() || null,
    });
    setSettings(updated);
    // See SettingsContext.jsx's refreshSettings comment -- both the
    // sidebar's Email link and the "Unmatched Emails" nav/tile depend on
    // this same receiveEnabled flag.
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

      <EditableSection
        title="Sending"
        value={{ sendEnabled: settings.sendEnabled, serverToken: "", fromAddress: settings.fromAddress || "" }}
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
            <p style={{ color: "#555" }}>From: {v.fromAddress || "Not set"}</p>
            {testResult && <p style={{ color: "#555" }}>{testResult}</p>}
          </>
        )}
        edit={(d, set) => (
          <>
            <div className="admin-checkbox-row">
              <label>
                <input type="checkbox" checked={d.sendEnabled} onChange={(e) => set("sendEnabled", e.target.checked)} />
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
                value={d.serverToken}
                onChange={(e) => set("serverToken", e.target.value)}
                placeholder={
                  settings.outboundConfigured ? "Configured — leave blank to keep it" : "Paste your server API token"
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
          }}
          onSave={saveReceive}
          onSaved={reload}
          view={(v) => (
            <>
              <p>
                <strong>{v.receiveEnabled ? "Enabled" : "Disabled"}</strong>
                {settings.inboundConfigured ? " · Configured" : " · Not configured"}
              </p>
              <p style={{ color: "#555" }}>Webhook username: {v.webhookUsername || "Not set"}</p>
              <p style={{ color: "#555" }}>Inbound address: {v.inboundEmailAddress || "Not set"}</p>
              <code style={{ display: "block", padding: "0.5rem", background: "#f4f4f4", wordBreak: "break-all" }}>
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
              <p style={{ color: "#555", fontSize: "0.9rem" }}>
                Lets partners email updates straight into this app — a match against a partner's own email (or
                any of their household adults') files it as a Newsletter automatically; anything else lands in
                the <strong>Unmatched Emails</strong> queue. On your Postmark server's Inbound stream Settings
                tab, check <strong>Include raw email content in JSON payload</strong>, then set the{" "}
                <strong>Inbound webhook</strong> URL to the address shown below, using the username/password you
                choose here -- Postmark sends them as HTTP Basic Auth on every request. Pick any dedicated
                subdomain for partners to send to (never the church's own real inbox).
              </p>
              <code
                style={{ display: "block", padding: "0.5rem", background: "#f4f4f4", wordBreak: "break-all" }}
              >
                https://{"<username>"}:{"<password>"}@{webhookUrl.replace(/^https?:\/\//, "")}
              </code>
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
                  placeholder={settings.inboundConfigured ? "Configured — leave blank to keep it" : "Choose a password"}
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
              <p style={{ color: "#555", fontSize: "0.85rem" }}>
                The address partners/participants were told (outside this app) to send mail to, on whatever
                inbound domain you configured in Postmark above -- purely informational, doesn't change the
                webhook itself. Also used as the Reply-To on a trip's "Request documents" email, so a
                participant's reply actually routes back into this queue instead of to no one.
              </p>
            </>
          )}
        />
      </div>
    </div>
  );
}
