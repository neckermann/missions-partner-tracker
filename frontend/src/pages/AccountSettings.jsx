import React, { useEffect, useState } from "react";
import {
  fetchCurrentUser,
  changePassword,
  setupMfa,
  verifyMfaSetup,
  disableMfa,
  updateNotifyByEmail,
  fetchPartners,
} from "../api/client.js";
import { passwordsMatch } from "../utils/password.js";
import { useSettings } from "../context/SettingsContext.jsx";

export default function AccountSettings() {
  const { enabledFeatures } = useSettings();
  const [user, setUser] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  function reloadUser() {
    return fetchCurrentUser().then(setUser);
  }

  useEffect(() => {
    reloadUser();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!passwordsMatch(newPassword, confirmPassword)) {
      setError("New password and confirmation do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell" style={{ maxWidth: 480 }}>
      <h2>My Account</h2>
      {user && (
        <p style={{ color: "#555" }}>
          Signed in as <strong>{user.email}</strong> ({user.role})
        </p>
      )}

      {!user ? null : (
        <div className="admin-section">
          <h3>Change Password</h3>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label>
              Current Password
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label>
              New Password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label>
              Confirm New Password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>

            {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
            {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

            <div>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Saving..." : "Update Password"}
              </button>
            </div>
          </form>
        </div>
      )}

      {user?.authProvider === "local" && <MfaSection user={user} onChange={reloadUser} />}
      {user && enabledFeatures.outboundEmail && <NotificationsSection user={user} onChange={reloadUser} />}
    </div>
  );
}

// Self-service opt-in for the admin digest email -- same self-service-
// from-Account-Settings pattern as MFA above. Turning the cadence to
// "No automatic digest" here does the same thing clicking "Unsubscribe"
// in a digest email's own footer does -- this is just the in-app
// equivalent for someone who's already logged in. Besides whatever
// cadence is picked below, this account may also receive an urgent
// broadcast immediately, bypassing this schedule entirely -- see the
// "Marking something urgent" note in USER_GUIDE.md.
function NotificationsSection({ user, onChange }) {
  const [partners, setPartners] = useState([]);
  const [cadence, setCadence] = useState(user.cadence || "");
  const [allPartners, setAllPartners] = useState(user.allPartners !== false);
  const [partnerIds, setPartnerIds] = useState(user.followedPartnerIds || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setCadence(user.cadence || "");
    setAllPartners(user.allPartners !== false);
    setPartnerIds(user.followedPartnerIds || []);
  }, [user]);

  useEffect(() => {
    fetchPartners({ archived: "false" }).then(setPartners);
  }, []);

  function togglePartner(id) {
    setPartnerIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSave() {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await updateNotifyByEmail({
        cadence: cadence || null,
        allPartners,
        partnerIds,
      });
      setSuccess("Notification preference saved.");
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't update your notification preference");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section">
      <h3>Email Notifications</h3>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <label style={{ display: "block", marginBottom: "0.75rem" }}>
        Digest cadence
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
          disabled={busy}
          style={{ display: "block", marginTop: "0.25rem" }}
        >
          <option value="">No automatic digest</option>
          <option value="biweekly">Biweekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
      </label>

      {cadence && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={allPartners}
                onChange={(e) => setAllPartners(e.target.checked)}
                disabled={busy}
              />
              Include all partners
            </label>
          </div>

          {!allPartners && (
            <div
              style={{
                marginTop: "0.5rem",
                maxHeight: 200,
                overflowY: "auto",
                border: "1px solid #ddd",
                borderRadius: 4,
                padding: "0.5rem",
              }}
            >
              {partners.length === 0 ? (
                <p style={{ color: "#555", fontSize: "0.9rem", margin: 0 }}>No partners available.</p>
              ) : (
                partners.map((p) => (
                  <div className="admin-checkbox-row" key={p.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={partnerIds.includes(p.id)}
                        onChange={() => togglePartner(p.id)}
                        disabled={busy}
                      />
                      {p.displayName}
                    </label>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <button type="button" className="btn" onClick={handleSave} disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>

      <p style={{ color: "#555", fontSize: "0.9rem" }}>
        A summary of new prayer requests, one-time needs, and newsletters, sent on whatever cadence you choose
        above -- plus, occasionally, an urgent item an admin or editor marks for immediate sending, which
        arrives right away regardless of this schedule. You can unsubscribe from the regular digest directly
        from the link in any digest email.
      </p>
    </div>
  );
}

function MfaSection({ user, onChange }) {
  const [setupData, setSetupData] = useState(null); // { secret, qrCode }
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleStartSetup() {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      setSetupData(await setupMfa());
    } catch (err) {
      setError(err.response?.data?.error || "Failed to start MFA setup");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmSetup(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await verifyMfaSetup(code);
      setSetupData(null);
      setCode("");
      setSuccess("Two-factor authentication is now enabled.");
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await disableMfa(disablePassword);
      setDisablePassword("");
      setSuccess("Two-factor authentication has been disabled.");
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to disable MFA");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section">
      <h3>Two-Factor Authentication</h3>

      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      {user.mfaEnabled ? (
        <>
          <p>
            <span className="status-pill good">Enabled</span>
          </p>
          <p style={{ color: "#555" }}>Your account requires a code from your authenticator app at login.</p>
          <form
            onSubmit={handleDisable}
            style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 320 }}
          >
            <label>
              Current Password
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
              />
            </label>
            <div>
              <button type="submit" className="btn danger" disabled={busy}>
                {busy ? "Disabling..." : "Disable Two-Factor Authentication"}
              </button>
            </div>
          </form>
        </>
      ) : setupData ? (
        <form
          onSubmit={handleConfirmSetup}
          style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 320 }}
        >
          <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
          <img src={setupData.qrCode} alt="MFA QR code" style={{ width: 200, height: 200 }} />
          <p style={{ fontSize: "0.85rem", color: "#555" }}>
            Can't scan it? Enter this code manually: <code>{setupData.secret}</code>
          </p>
          <label>
            Enter the 6-digit code from the app to confirm
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Confirming..." : "Confirm & Enable"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setSetupData(null);
                setCode("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            <span className="status-pill">Disabled</span>
          </p>
          <p style={{ color: "#555" }}>
            Add an extra step at login using an authenticator app on your phone.
          </p>
          <button className="btn" onClick={handleStartSetup} disabled={busy}>
            {busy ? "Starting..." : "Enable Two-Factor Authentication"}
          </button>
        </>
      )}
    </div>
  );
}
