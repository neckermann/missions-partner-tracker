import React, { useEffect, useState } from "react";
import {
  fetchCurrentUser,
  changePassword,
  setupMfa,
  verifyMfaSetup,
  regenerateRecoveryCodes,
  disableMfa,
  updateNotifyByEmail,
  setKeyDateEmailOptOut,
  updateMyProfile,
  fetchPartners,
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  browserSupportsWebAuthn,
} from "../api/client.js";
import { passkeyErrorMessage } from "../utils/passkeyError.js";
import { passwordsMatch } from "../utils/password.js";
import { useSettings } from "../context/SettingsContext.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import MfaAppGuide from "../components/MfaAppGuide.jsx";
import ThemeToggle from "../components/shared/ThemeToggle.jsx";
import RecoveryCodesPanel from "../components/RecoveryCodesPanel.jsx";
import CopyButton from "../components/shared/CopyButton.jsx";

const emptyPasswordDraft = { currentPassword: "", newPassword: "", confirmPassword: "" };

// Client-side validation failures are thrown in the API-error shape so
// EditableSection renders them through its normal error path.
function validationError(message) {
  return { response: { data: { error: message } } };
}

export default function AccountSettings() {
  const { enabledFeatures } = useSettings();
  const [user, setUser] = useState(null);
  const isGuest = user?.role === "guest";

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
        <p style={{ color: "var(--muted)" }}>
          Signed in as <strong>{user.email}</strong> ({isGuest ? "Guest" : user.role})
        </p>
      )}

      {user && <ProfileSection user={user} onChange={reloadUser} />}

      {!user ? null : (
        <EditableSection
          title="Change Password"
          value={emptyPasswordDraft}
          onSave={savePassword}
          onSaved={() => {}}
          view={() => <p style={{ color: "var(--muted)" }}>•••••••• — click Edit to change your password.</p>}
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
      {user?.authProvider === "local" && <PasskeysSection onChange={reloadUser} />}
      {/* The digest is church-wide content, so a guest gets it only for the partners they hold a seat on. */}
      {user && enabledFeatures.outboundEmail && (!isGuest || user.careTeamSeats?.length > 0) && (
        <EmailDispatchSection user={user} onChange={reloadUser} />
      )}
      {/* Anyone who looks after partners may get the daily key-date email: a care team member (a guest
          included) or someone on the missions team. */}
      {user &&
        enabledFeatures.keyDates &&
        enabledFeatures.outboundEmail &&
        (user.careTeamSeats?.length > 0 || user.onMissionsTeam) && (
          <KeyDateEmailSection user={user} onChange={reloadUser} />
        )}

      <div className="admin-section">
        <h3>Appearance</h3>
        <p style={{ color: "var(--muted)" }}>
          Light, dark, or match your system setting. This is saved on this browser only -- it doesn't follow
          you to another device.
        </p>
        <ThemeToggle />
      </div>
    </div>
  );
}

// Your phone and a line about yourself, so the church can reach you for an update.
function ProfileSection({ user, onChange }) {
  return (
    <EditableSection
      title="Your details"
      value={{ phone: user.phone || "", profile: user.profile || "" }}
      onSave={async (draft) => {
        await updateMyProfile({ phone: draft.phone, profile: draft.profile });
        await onChange();
      }}
      view={(v) => (
        <div style={{ color: "var(--muted)" }}>
          <div>Phone: {v.phone || "not added"}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{v.profile || "No note about you yet."}</div>
        </div>
      )}
      edit={(draft, set) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label>
            Phone
            <input
              type="tel"
              value={draft.phone}
              maxLength={40}
              onChange={(e) => set("phone", e.target.value)}
            />
          </label>
          <label>
            About you
            <textarea
              rows={3}
              value={draft.profile}
              maxLength={1000}
              placeholder="How you help, or when you are easiest to reach"
              onChange={(e) => set("profile", e.target.value)}
            />
          </label>
        </div>
      )}
    />
  );
}

// The daily key-date email: one message on a day a birthday, anniversary or milestone is due
// for a partner you look after. Turning it off stops the email only; the bell alert stays.
function KeyDateEmailSection({ user, onChange }) {
  const optedOut = user.keyDateEmailOptOut === true;
  return (
    <EditableSection
      title="Key-date email"
      value={{ optOut: optedOut }}
      onSave={async (draft) => {
        await setKeyDateEmailOptOut(draft.optOut);
        await onChange();
      }}
      view={(v) => (
        <p style={{ color: "var(--muted)" }}>
          {v.optOut
            ? "Off. You won't get the daily email about coming birthdays and anniversaries for your partners."
            : "On. You get one email on a day a birthday, anniversary or milestone is coming up for a partner you look after."}{" "}
          The alert on the bell stays either way.
        </p>
      )}
      edit={(draft, set) => (
        <div className="admin-checkbox-row">
          <label>
            <input
              type="checkbox"
              checked={!draft.optOut}
              onChange={(e) => set("optOut", !e.target.checked)}
            />
            Email me about coming birthdays and anniversaries for my partners
          </label>
        </div>
      )}
    />
  );
}

// Self-service opt-in for the admin digest email. "No automatic digest" matches the
// "Unsubscribe" link in the email footer. An urgent dispatch can still arrive immediately,
// regardless of this schedule (see USER_GUIDE.md, "Marking something urgent").
const CADENCE_LABELS = {
  "": "No automatic digest",
  biweekly: "Biweekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const SCOPE_LABELS = {
  owned: "the partners you look after",
  all: "all partners",
  followed: "the partners you pick",
};

function EmailDispatchSection({ user, onChange }) {
  const { cadenceTiersEnabled, ownerGroupName } = useSettings();
  const [partners, setPartners] = useState([]);
  // A guest's digest is always the partners they look after; they get no choice of scope.
  const isGuest = user.role === "guest";
  const value = {
    cadence: user.cadence || "",
    digestScope: isGuest ? "owned" : user.digestScope || "owned",
    partnerIds: user.followedPartnerIds || [],
  };

  // "" (no automatic digest) is always offered, plus this admin's own saved cadence even if
  // it has since been disabled, so their current choice is never hidden.
  const cadenceLabelEntries = Object.entries(CADENCE_LABELS).filter(
    ([tierValue]) => tierValue === "" || tierValue === value.cadence || cadenceTiersEnabled[tierValue]
  );

  useEffect(() => {
    fetchPartners({ archived: "false" }).then(setPartners);
  }, []);

  async function save(draft) {
    await updateNotifyByEmail({
      cadence: draft.cadence || null,
      digestScope: draft.digestScope,
      partnerIds: draft.partnerIds,
    });
    await onChange();
  }

  return (
    <EditableSection
      title="Email updates"
      value={value}
      onSave={save}
      view={(v) => (
        <p style={{ color: "var(--muted)" }}>
          {CADENCE_LABELS[v.cadence]}
          {v.cadence
            ? v.digestScope === "followed"
              ? `, ${v.partnerIds.length} selected partner${v.partnerIds.length === 1 ? "" : "s"}`
              : `, ${SCOPE_LABELS[v.digestScope] || SCOPE_LABELS.all}`
            : ""}
          . A summary of new prayer requests, one-time needs, and newsletters -- plus, occasionally, an urgent
          item an admin or editor marks for immediate sending, which arrives right away regardless of this
          schedule. You can unsubscribe from the regular digest directly from the link in any digest email.
        </p>
      )}
      edit={(draft, set) => (
        <>
          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            How often
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

          {draft.cadence && !isGuest && (
            <fieldset style={{ border: 0, padding: 0, margin: "0 0 0.5rem" }}>
              <legend style={{ fontWeight: 600 }}>What the digest covers</legend>
              {[
                [
                  "owned",
                  `The partners I look after${user.onMissionsTeam ? ` (my care teams, and the ${ownerGroupName}'s partners)` : ""}`,
                ],
                ["all", "All partners"],
                ["followed", "Only partners I pick"],
              ].map(([scope, label]) => (
                <label key={scope} className="checkbox-option">
                  <input
                    type="radio"
                    name="digestScope"
                    checked={draft.digestScope === scope}
                    onChange={() => set("digestScope", scope)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {draft.cadence && isGuest && (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              Your digest covers the partners you look after, and only them.
            </p>
          )}

          {draft.cadence && (
            <div style={{ marginBottom: "0.75rem" }}>
              {draft.digestScope === "followed" && !isGuest && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    maxHeight: 200,
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "0.5rem",
                  }}
                >
                  {partners.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
                      No partners available.
                    </p>
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

// Passkeys, the other second factor: added from this device, removed with the password.
// Deliberately not an EditableSection: a multi-step flow with its own per-action error handling.
function PasskeysSection({ onChange }) {
  const [list, setList] = useState(null); // { passkeys, max }
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState(null); // a passkey id
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const supported = browserSupportsWebAuthn();

  const load = () =>
    fetchPasskeys()
      .then(setList)
      .catch(() => setList({ passkeys: [], max: 5 }));
  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await registerPasskey(label.trim());
      setLabel("");
      setSuccess("Passkey added.");
      await load();
      await onChange();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await removePasskey(removing, password);
      setRemoving(null);
      setPassword("");
      setSuccess("Passkey removed.");
      await load();
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't remove it");
    } finally {
      setBusy(false);
    }
  }

  if (!list) return null;
  const full = list.passkeys.length >= list.max;
  return (
    <div className="admin-section">
      <h3>Passkeys</h3>
      <p style={{ color: "var(--muted)" }}>
        A passkey is your fingerprint, face or screen lock (or a security key) used as the second step at
        login. Add one on each device you use, so losing one never locks you out.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {success && <p style={{ color: "var(--brand-color-safe, #2a5d3c)" }}>{success}</p>}

      {list.passkeys.length > 0 && (
        <ul
          style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          {list.passkeys.map((p) => (
            <li key={p.id}>
              <strong>{p.label}</strong>
              <span style={{ color: "var(--muted)" }}>
                {" "}
                · added {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt
                  ? `, last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                  : ", not used yet"}
              </span>{" "}
              <button type="button" className="btn secondary" onClick={() => setRemoving(p.id)}>
                Remove
              </button>
              {removing === p.id && (
                <form
                  onSubmit={handleRemove}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    maxWidth: 320,
                    margin: "0.5rem 0",
                  }}
                >
                  <label>
                    Current Password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="submit" className="btn danger" disabled={busy}>
                      Remove passkey
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setRemoving(null);
                        setPassword("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {list.demo && (
        <p style={{ color: "var(--muted)" }}>
          This is the public demo: try adding and removing a passkey. The login is shared, so it never changes
          how anyone signs in here.
        </p>
      )}
      {!supported ? (
        <p style={{ color: "var(--muted)" }}>This browser can't create passkeys.</p>
      ) : full ? (
        <p style={{ color: "var(--muted)" }}>You have the most passkeys allowed ({list.max}).</p>
      ) : (
        <form
          onSubmit={handleAdd}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 320 }}
        >
          <label>
            Name (optional)
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              placeholder="e.g. My phone"
            />
          </label>
          <div>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Waiting for your device..." : "Add a passkey"}
            </button>
          </div>
        </form>
      )}
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
  // Recovery codes on show: just made at enrolment, or a new set asked for. Shown once.
  const [shownCodes, setShownCodes] = useState(null);
  const [codesPassword, setCodesPassword] = useState("");

  async function handleNewCodes(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { recoveryCodes } = await regenerateRecoveryCodes(codesPassword);
      setCodesPassword("");
      setShownCodes(recoveryCodes);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't make new recovery codes");
    } finally {
      setBusy(false);
    }
  }

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
      const result = await verifyMfaSetup(code);
      if (result?.recoveryCodes?.length) setShownCodes(result.recoveryCodes);
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

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {success && <p style={{ color: "var(--brand-color-safe, #2a5d3c)" }}>{success}</p>}

      {shownCodes ? (
        <RecoveryCodesPanel codes={shownCodes} onDone={() => setShownCodes(null)} doneLabel="Done" />
      ) : user.mfaEnabled && !user.authenticatorApp ? (
        <>
          <p>
            <span className="status-pill good">Enabled with passkeys</span>
          </p>
          <p style={{ color: "var(--muted)" }}>
            Your passkeys are your second step at login. Manage them below.
          </p>
        </>
      ) : user.mfaEnabled ? (
        <>
          <p>
            <span className="status-pill good">Enabled</span>
          </p>
          <p style={{ color: "var(--muted)" }}>
            Your account requires a code from your authenticator app at login.
          </p>
          <p style={{ color: "var(--muted)" }}>
            Recovery codes left: <strong>{user.recoveryCodesRemaining ?? 0}</strong>.{" "}
            {(user.recoveryCodesRemaining ?? 0) <= 2
              ? "Make a new set soon so you can still get in if you lose your phone."
              : "Each works once if you lose your phone."}
          </p>
          <form
            onSubmit={handleNewCodes}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              maxWidth: 320,
              marginBottom: "1rem",
            }}
          >
            <label>
              Your password, to make new recovery codes
              <input
                type="password"
                value={codesPassword}
                onChange={(e) => setCodesPassword(e.target.value)}
                required
              />
            </label>
            <div>
              <button type="submit" className="btn secondary" disabled={busy}>
                Make a new set of recovery codes
              </button>
            </div>
          </form>
          {user.twoFactorRequired && !user.passkeyCount ? (
            <p style={{ color: "var(--muted)" }}>
              Your church requires two-factor authentication for everyone, so it can't be turned off here. If
              you lose your authenticator app, ask an admin to reset it.
            </p>
          ) : (
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
                  {busy
                    ? "Disabling..."
                    : user.passkeyCount
                      ? "Stop using the authenticator app"
                      : "Disable Two-Factor Authentication"}
                </button>
              </div>
            </form>
          )}
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
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Can't scan it? Enter this code manually: <code>{setupData.secret}</code>{" "}
              <CopyButton text={setupData.secret} label="Copy the setup key" />
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
          <p style={{ color: "var(--muted)" }}>
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
