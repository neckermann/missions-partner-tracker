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
import EditableSection from "../components/admin/EditableSection.jsx";
import MfaAppGuide from "../components/MfaAppGuide.jsx";

const emptyPasswordDraft = { currentPassword: "", newPassword: "", confirmPassword: "" };

// A client-side validation failure (mismatch/too-short) is thrown in the
// same { response: { data: { error } } } shape EditableSection's catch
// block already expects from a real API error, so it renders through the
// same friendly-error path instead of a second, parallel error UI.
function validationError(message) {
  return { response: { data: { error: message } } };
}

export default function AccountSettings() {
  const { enabledFeatures } = useSettings();
  const [user, setUser] = useState(null);

  function reloadUser() {
    return fetchCurrentUser().then(setUser);
  }

  useEffect(() => {
    reloadUser();
  }, []);

  async function savePassword(draft) {
    if (!passwordsMatch(draft.newPassword, draft.confirmPassword)) {
      throw validationError("New password and confirmation do not match");
    }
    if (draft.newPassword.length < 8) {
      throw validationError("New password must be at least 8 characters");
    }
    await changePassword(draft.currentPassword, draft.newPassword);
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
        <EditableSection
          title="Change Password"
          value={emptyPasswordDraft}
          onSave={savePassword}
          onSaved={() => {}}
          view={() => <p style={{ color: "#555" }}>•••••••• — click Edit to change your password.</p>}
          edit={(draft, set) => (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <label>
                Current Password
                <input
                  type="password"
                  value={draft.currentPassword}
                  onChange={(e) => set("currentPassword", e.target.value)}
                  required
                />
              </label>
              <label>
                New Password
                <input
                  type="password"
                  value={draft.newPassword}
                  onChange={(e) => set("newPassword", e.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <label>
                Confirm New Password
                <input
                  type="password"
                  value={draft.confirmPassword}
                  onChange={(e) => set("confirmPassword", e.target.value)}
                  minLength={8}
                  required
                />
              </label>
            </div>
          )}
        />
      )}

      {user?.authProvider === "local" && <MfaSection user={user} onChange={reloadUser} />}
      {user && enabledFeatures.outboundEmail && <EmailDispatchSection user={user} onChange={reloadUser} />}
    </div>
  );
}

// Self-service opt-in for the admin digest email -- same self-service-
// from-Account-Settings pattern as MFA above. Turning the cadence to
// "No automatic digest" here does the same thing clicking "Unsubscribe"
// in a digest email's own footer does -- this is just the in-app
// equivalent for someone who's already logged in. Besides whatever
// cadence is picked below, this account may also receive an urgent
// dispatch immediately, bypassing this schedule entirely -- see the
// "Marking something urgent" note in USER_GUIDE.md.
const CADENCE_LABELS = {
  "": "No automatic digest",
  biweekly: "Biweekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

function EmailDispatchSection({ user, onChange }) {
  const { cadenceTiersEnabled } = useSettings();
  const [partners, setPartners] = useState([]);
  const value = {
    cadence: user.cadence || "",
    allPartners: user.allPartners !== false,
    partnerIds: user.followedPartnerIds || [],
  };

  // "" (no automatic digest) is always offered, and so is this admin's
  // own already-saved cadence even if it's since been disabled (#209) --
  // don't silently hide someone's current choice from them, same
  // reasoning PublicSubscribeForm.jsx's own comment gives for why *it*
  // needs no such exception (new-subscriber-only, nothing saved yet).
  const cadenceLabelEntries = Object.entries(CADENCE_LABELS).filter(
    ([tierValue]) => tierValue === "" || tierValue === value.cadence || cadenceTiersEnabled[tierValue]
  );

  useEffect(() => {
    fetchPartners({ archived: "false" }).then(setPartners);
  }, []);

  async function save(draft) {
    await updateNotifyByEmail({
      cadence: draft.cadence || null,
      allPartners: draft.allPartners,
      partnerIds: draft.partnerIds,
    });
    await onChange();
  }

  return (
    <EditableSection
      title="Email Dispatch"
      value={value}
      onSave={save}
      view={(v) => (
        <p style={{ color: "#555" }}>
          {CADENCE_LABELS[v.cadence]}
          {v.cadence
            ? v.allPartners
              ? ", all partners"
              : `, ${v.partnerIds.length} selected partner${v.partnerIds.length === 1 ? "" : "s"}`
            : ""}
          . A summary of new prayer requests, one-time needs, and newsletters -- plus, occasionally, an urgent
          item an admin or editor marks for immediate sending, which arrives right away regardless of this
          schedule. You can unsubscribe from the regular digest directly from the link in any digest email.
        </p>
      )}
      edit={(draft, set) => (
        <>
          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            Digest cadence
            <select
              value={draft.cadence}
              onChange={(e) => set("cadence", e.target.value)}
              style={{ display: "block", marginTop: "0.25rem" }}
            >
              {cadenceLabelEntries.map(([tierValue, label]) => (
                <option key={tierValue || "none"} value={tierValue}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {draft.cadence && (
            <div style={{ marginBottom: "0.75rem" }}>
              <div className="admin-checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.allPartners}
                    onChange={(e) => set("allPartners", e.target.checked)}
                  />
                  Include all partners
                </label>
              </div>

              {!draft.allPartners && (
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
                            checked={draft.partnerIds.includes(p.id)}
                            onChange={() =>
                              set(
                                "partnerIds",
                                draft.partnerIds.includes(p.id)
                                  ? draft.partnerIds.filter((id) => id !== p.id)
                                  : [...draft.partnerIds, p.id]
                              )
                            }
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
        </>
      )}
    />
  );
}

// Deliberately not an EditableSection: this isn't "edit a field, save" --
// it's a multi-step security flow with three distinct shapes (enabled with
// a disable-confirmation form, mid-setup with a QR code and a confirm
// step, or disabled with a start button) that doesn't reduce to a single
// view/edit toggle. Keeps its own try/catch-per-action error handling,
// which already shows a plain-language message per action.
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
        <>
          <div style={{ maxWidth: 480 }}>
            <MfaAppGuide />
          </div>
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
        </>
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
