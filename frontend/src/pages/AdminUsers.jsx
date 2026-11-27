import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  fetchReachablePartners,
  fetchUsers,
  deleteUser,
  sendUserSetupLink,
  fetchCurrentUser,
  resetUserMfa,
  fetchUser,
  updateUser,
  fetchTrips,
  updateChurchSettings,
} from "../api/client.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import Table from "../components/shared/Table.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import { formatUtcDate } from "../utils/format.js";
import { GuestGrantsPanel } from "../components/admin/GuestAccessPanels.jsx";
import TripGrantPicker from "../components/admin/TripGrantPicker.jsx";
import CareSeatPicker from "../components/admin/CareSeatPicker.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";

const emptyForm = {
  email: "",
  firstName: "",
  lastName: "",
  phone: "",
  profile: "",
  onMissionsTeam: false,
  role: "editor",
  authProvider: "local",
  active: true,
  password: "",
  // Create-only: email a secure link so the person sets their own password
  // (no password is ever typed by an admin or emailed), and optionally
  // force two-factor enrollment at first sign-in.
  sendWelcomeEmail: true,
  requireMfa: false,
  mfaSetupRequired: false,
  mfaEnabled: false,
  // Only used when an existing non-guest is changed to a guest; a guest's
  // own trips are managed live in GuestGrantsPanel instead.
  tripAccess: [],
  // Same idea for care team seats: [{ partnerId }], only sent when promoting.
  careTeam: [],
};

// Why a guest account currently can't sign in, in an admin's words. Matches
// the `inactiveReason` the API computes (never set for the full roles).
const INACTIVE_LABELS = {
  deactivated: "Deactivated",
  expired: "Access expired",
  no_access: "No trips left",
};

// A user list like the other consolidated list pages (Table, row opens a QuickActionModal edit form).
// Create lives on its own Wizard page (AdminUserForm.jsx); edit stays a modal since it has no welcome-email step.
export default function AdminUsers() {
  const location = useLocation();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [trips, setTrips] = useState([]);
  const [partners, setPartners] = useState([]);
  const { enabledFeatures, ownerGroupName } = useSettings();
  const careEnabled = !!enabledFeatures?.careTeam;
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState(null); // { id, form } for edit
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");
  const [manualSetupLink, setManualSetupLink] = useState(null); // { name, email, url } | null
  // Guests whose access has lapsed or been removed, filtered from the list's own `inactiveReason`.
  const [inactiveOnly, setInactiveOnly] = useState(false);

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  function reload() {
    fetchUsers().then(setUsers).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchCurrentUser().then(setCurrentUser);
    fetchTrips().then(setTrips).catch(console.error);
    if (careEnabled) fetchReachablePartners().then(setPartners).catch(console.error);
  }, [careEnabled]);

  async function handleDelete(id, email) {
    const confirmed = await confirmDialog({
      title: `Delete user ${email}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    setError("");
    try {
      await deleteUser(id);
      reload();
    } catch (err) {
      reportError(err, "Failed to delete user");
    }
  }

  // The church-wide two-factor requirement. Turning it on signs out everyone who has not enrolled,
  // so it asks first; the server refuses unless the admin has enrolled themselves.
  async function handleToggleTwoFactor(notEnrolled) {
    setError("");
    const turningOn = !currentUser?.twoFactorRequired;
    if (turningOn) {
      const confirmed = await confirmDialog({
        title: "Require two-factor for everyone?",
        body: (
          <ConfirmMessageBody>
            {notEnrolled > 0
              ? `${notEnrolled} active account${notEnrolled === 1 ? " hasn't" : "s haven't"} set up two-factor yet. They will be signed out and asked to set it up the next time they sign in.`
              : "Everyone already has two-factor set up."}{" "}
            Nobody will be able to turn it off for themselves. If someone loses their authenticator, use Reset
            MFA on their row.
          </ConfirmMessageBody>
        ),
        confirmLabel: "Require it",
      });
      if (!confirmed) return;
    }
    try {
      await updateChurchSettings({ requireTwoFactor: turningOn });
      setCurrentUser(await fetchCurrentUser());
      reload();
    } catch (err) {
      reportError(err, "Couldn't change the two-factor requirement");
    }
  }

  // Passwordless sign-in. Turning it on ends password sign-in for everyone, so it says who will sign
  // in by emailed link first; the server refuses unless email works and the admin has a passkey.
  async function handleTogglePasswordless(withoutPasskey) {
    setError("");
    const turningOn = !currentUser?.passwordlessRequired;
    if (turningOn) {
      const confirmed = await confirmDialog({
        title: "Turn on passwordless sign-in?",
        body: (
          <ConfirmMessageBody>
            Nobody will be able to sign in with a password any more.{" "}
            {withoutPasskey > 0
              ? `${withoutPasskey} active account${withoutPasskey === 1 ? " has" : "s have"} no passkey yet and will sign in with an emailed link until they add one.`
              : "Everyone already has a passkey."}{" "}
            If email stops working, an admin has to reset a person's two-factor and hand over a setup link.
            Passwords aren't deleted, so you can turn this off again.
          </ConfirmMessageBody>
        ),
        confirmLabel: "Turn it on",
      });
      if (!confirmed) return;
    }
    try {
      await updateChurchSettings({ requirePasswordless: turningOn });
      setCurrentUser(await fetchCurrentUser());
      reload();
    } catch (err) {
      reportError(err, "Couldn't change passwordless sign-in");
    }
  }

  // Offers "Sign in with a passkey" on the sign-in page beside the password form. Passwords keep working.
  async function handleTogglePasskeySignIn(allow) {
    setError("");
    try {
      await updateChurchSettings({ allowPasskeySignIn: allow });
      setCurrentUser(await fetchCurrentUser());
    } catch (err) {
      reportError(err, "Couldn't change passkey sign-in");
    }
  }

  // Recovery path for a lost/broken authenticator device — clears MFA so
  // the user can log in with just their password and re-enroll themselves.
  async function handleResetMfa(id, email) {
    const confirmed = await confirmDialog({
      title: `Reset two-factor authentication for ${email}?`,
      body: <ConfirmMessageBody>They will need to re-enroll.</ConfirmMessageBody>,
      confirmLabel: "Reset",
    });
    if (!confirmed) return;
    setError("");
    try {
      await resetUserMfa(id);
      reload();
    } catch (err) {
      reportError(err, "Failed to reset MFA");
    }
  }

  // Sends (or re-sends) the password-setup email to an account that has no
  // password yet; a fresh link replaces any earlier one.
  async function handleSendSetupLink(id, email) {
    setError("");
    setManualSetupLink(null);
    try {
      const result = await sendUserSetupLink(id);
      if (result?.manualSetupUrl) {
        setManualSetupLink({ email, url: result.manualSetupUrl });
      } else {
        setNotice(`Setup link sent to ${email}.`);
      }
    } catch (err) {
      reportError(err, "Couldn't send the setup link");
    }
  }

  async function openEdit(u) {
    setFormError("");
    // `loaded: false` keeps the form from rendering until fetchUser resolves: edits made against
    // `emptyForm` in that window would be silently overwritten when the server data landed.
    setEditingUser({ id: u.id, form: emptyForm, loaded: false });
    try {
      const full = await fetchUser(u.id);
      setEditingUser({
        id: u.id,
        loaded: true,
        // Remembered so the modal knows whether this is an existing guest
        // (trips managed live) or someone being promoted to one (pick the
        // first trips here, sent with the save).
        originalRole: full.role,
        form: {
          ...emptyForm,
          ...full,
          password: "",
          tripAccess: [],
          careTeam: [],
        },
      });
    } catch {
      setFormError("Couldn't load this user.");
    }
  }

  function updateForm(field, value) {
    setEditingUser((e) => ({ ...e, form: { ...e.form, [field]: value } }));
  }

  async function handleSaveUser() {
    const { id, form, originalRole } = editingUser;
    const payload = { ...form };
    if (!payload.password) delete payload.password;
    // First trips are only sent when promoting someone to a guest; an
    // existing guest's trips are changed through GuestGrantsPanel.
    const becomingGuest = form.role === "guest" && originalRole !== "guest";
    if (!becomingGuest) {
      delete payload.tripAccess;
      delete payload.careTeam;
    }
    // A guest reaches something only through a trip or a care team seat, and
    // may already hold seats from before they were promoted.
    const existingSeats = careEnabled ? (form.careTeamSeats || []).length : 0;
    const newSeats = careEnabled ? form.careTeam.length : 0;
    if (becomingGuest && form.tripAccess.length + newSeats + existingSeats === 0) {
      throw {
        response: {
          data: {
            error: careEnabled
              ? "Choose at least one trip or partner for this guest"
              : "Choose at least one trip for this guest",
          },
        },
      };
    }
    if (becomingGuest && (!careEnabled || newSeats === 0)) delete payload.careTeam;
    // read-only API extras
    delete payload.careTeamSeats;

    // sendWelcomeEmail/requireMfa only exist on create. The grants array
    // and read-only API extras aren't part of the update schema either.
    const {
      email,
      authProvider,
      sendWelcomeEmail,
      requireMfa,
      inactiveReason,
      passwordSetupPending,
      createdAt,
      lastLoginAt,
      ...updatable
    } = payload;
    await updateUser(id, updatable);
    reload();
  }

  const columns = [
    { key: "email", label: "Email", sortable: true },
    {
      key: "name",
      label: "Name",
      render: (u) => [u.firstName, u.lastName].filter(Boolean).join(" "),
    },
    {
      key: "role",
      label: "Role",
      render: (u) => (
        <>
          {u.role === "guest" ? "Guest" : u.role}
          {u.role === "guest" &&
            u.tripAccess?.map((g) => (
              <div
                key={g.id}
                style={{ fontSize: "0.75rem", color: g.active ? "var(--muted)" : "var(--danger)" }}
              >
                {[g.trip.partner?.displayName, g.trip.name || g.trip.type].filter(Boolean).join(" — ") ||
                  "Trip"}
                {g.effectiveExpiresAt &&
                  ` · ${g.active ? "until" : "ended"} ${formatUtcDate(g.effectiveExpiresAt)}`}
              </div>
            ))}
          {u.careTeamSeats?.map((seat) => (
            <div key={seat.id} style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Care team: {seat.partner.displayName}
              {seat.isLead ? " (Lead)" : ""}
            </div>
          ))}
        </>
      ),
    },
    {
      key: "active",
      label: "Active",
      render: (u) =>
        u.inactiveReason ? (
          <span className="status-pill warn">{INACTIVE_LABELS[u.inactiveReason]}</span>
        ) : u.passwordSetupPending ? (
          <span className="status-pill warn">Awaiting setup</span>
        ) : u.active ? (
          "Yes"
        ) : (
          "No"
        ),
    },
    {
      key: "mfa",
      label: "MFA",
      render: (u) =>
        u.authProvider !== "local" ? (
          "—"
        ) : u.mfaEnabled ? (
          <span className="status-pill good">Enabled</span>
        ) : u.mfaSetupRequired ? (
          <span className="status-pill warn">Required</span>
        ) : (
          <span className="status-pill">Off</span>
        ),
    },
    {
      key: "lastLoginAt",
      label: "Last Login",
      render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"),
    },
  ];

  const inactiveCount = users.filter((u) => u.inactiveReason).length;
  const shownUsers = inactiveOnly ? users.filter((u) => u.inactiveReason) : users;
  // Who still has to set up two-factor: active accounts that sign in with a password.
  const signingIn = users.filter((u) => u.active && u.authProvider === "local");
  const notEnrolled = signingIn.filter((u) => !u.mfaEnabled).length;
  const twoFactorRequired = !!currentUser?.twoFactorRequired;
  // Only worth saying once the list has loaded.
  const onlyOneAdmin = users.length > 0 && users.filter((u) => u.role === "admin" && u.active).length === 1;
  const passwordlessOn = !!currentUser?.passwordlessRequired;
  const withoutPasskey = signingIn.filter((u) => !u.passkeyCount).length;
  // Why the passwordless switch can't be used yet, if it can't (the server checks the same).
  const passwordlessBlocker = passwordlessOn
    ? null
    : currentUser?.passwordlessBlockedByDemo
      ? "Passwordless sign-in is switched off on this demo: it would end password sign-in for the shared logins and lock every visitor out until the next reset. A real install can turn it on here."
      : !currentUser?.emailReady
        ? "Turn on outbound email and finish setting it up first (Settings → Email): people without a passkey sign in through an emailed link."
        : !currentUser?.passkeyCount
          ? "Add a passkey to your own account first (My Account), so turning this on doesn't lock you out."
          : null;

  return (
    <div className="admin-shell">
      <SettingsPageHeader
        title={`Users (${users.length})`}
        crumbLabel="Manage Users"
        actions={
          <Link to="/admin/settings/users/new" className="btn">
            + Add User
          </Link>
        }
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {onlyOneAdmin && (
        <p role="note" className="admin-section" style={{ margin: "1rem 0" }}>
          <strong>You are the only administrator.</strong> If you lose your phone and your recovery codes,
          nobody inside the app can let you back in. Add a second administrator you trust so each can reset
          the other's two-factor.
        </p>
      )}
      {manualSetupLink && <ManualSendNotice recipients={manualSetupLink} />}

      <div className="admin-section" style={{ margin: "1rem 0" }}>
        <h3 style={{ marginTop: 0 }}>Two-factor sign-in</h3>
        <p style={{ margin: "0.25rem 0 0.75rem" }}>
          {twoFactorRequired ? (
            <span className="status-pill good">Required for everyone</span>
          ) : (
            <span className="status-pill">Optional</span>
          )}{" "}
          {notEnrolled === 0
            ? "Everyone has set it up."
            : `${notEnrolled} of ${signingIn.length} active account${signingIn.length === 1 ? "" : "s"} ${notEnrolled === 1 ? "hasn't" : "haven't"} set it up yet.`}
        </p>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => handleToggleTwoFactor(notEnrolled)}
          disabled={!twoFactorRequired && !currentUser?.mfaEnabled}
        >
          {twoFactorRequired ? "Stop requiring it" : "Require it for everyone"}
        </button>
        {!twoFactorRequired && currentUser && !currentUser.mfaEnabled && (
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 0 }}>
            Set up two-factor on your own account first (My Account), so turning this on doesn't lock you out.
          </p>
        )}
      </div>

      <div className="admin-section" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Passkey sign-in</h3>
        <div className="admin-checkbox-row">
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={passwordlessOn || !!currentUser?.allowPasskeySignIn}
              disabled={passwordlessOn}
              onChange={(e) => handleTogglePasskeySignIn(e.target.checked)}
            />
            Show "Sign in with a passkey" on the sign-in page
          </label>
        </div>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 0 }}>
          {passwordlessOn
            ? "On while passwordless sign-in is on."
            : "People who have added a passkey (My account) can use their fingerprint, face or screen lock instead of typing a password. Passwords keep working."}
        </p>
      </div>

      <div className="admin-section" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Passwordless sign-in</h3>
        <p style={{ margin: "0.25rem 0 0.75rem" }}>
          {passwordlessOn ? (
            <span className="status-pill good">On: no passwords</span>
          ) : (
            <span className="status-pill">Off</span>
          )}{" "}
          {withoutPasskey === 0
            ? "Everyone has a passkey."
            : `${withoutPasskey} of ${signingIn.length} active account${signingIn.length === 1 ? "" : "s"} ${withoutPasskey === 1 ? "has" : "have"} no passkey yet${passwordlessOn ? " and sign in with an emailed link" : ""}.`}
        </p>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => handleTogglePasswordless(withoutPasskey)}
          disabled={!!passwordlessBlocker}
        >
          {passwordlessOn ? "Turn off passwordless sign-in" : "Turn on passwordless sign-in"}
        </button>
        {passwordlessBlocker && (
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 0 }}>{passwordlessBlocker}</p>
        )}
        {passwordlessOn && (
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 0 }}>
            Two-factor is required while this is on. Someone who loses their passkey asks an admin to Reset
            MFA.
          </p>
        )}
      </div>

      {(inactiveCount > 0 || inactiveOnly) && (
        <div className="admin-checkbox-row" style={{ marginBottom: "0.5rem" }}>
          <label>
            <input
              type="checkbox"
              checked={inactiveOnly}
              onChange={(e) => setInactiveOnly(e.target.checked)}
            />
            Inactive accounts only ({inactiveCount}) — guests whose access has ended or been removed
          </label>
        </div>
      )}

      <Table
        columns={columns}
        rows={shownUsers}
        onRowClick={openEdit}
        emptyMessage={inactiveOnly ? "No inactive accounts." : "No users yet."}
        renderActions={(u) => (
          <>
            {u.authProvider === "local" && u.active && u.passwordSetupPending && (
              <button className="btn secondary small" onClick={() => handleSendSetupLink(u.id, u.email)}>
                Send setup link
              </button>
            )}
            {u.authProvider === "local" && u.mfaEnabled && (
              <button className="btn secondary small" onClick={() => handleResetMfa(u.id, u.email)}>
                Reset MFA
              </button>
            )}
            <button
              className="btn danger small"
              disabled={currentUser?.id === u.id}
              title={currentUser?.id === u.id ? "You can't delete your own account" : ""}
              onClick={() => handleDelete(u.id, u.email)}
            >
              Delete
            </button>
          </>
        )}
      />

      {editingUser && (
        <QuickActionModal
          title="Edit User"
          onClose={() => setEditingUser(null)}
          onSubmit={handleSaveUser}
          submitDisabled={!editingUser.loaded}
        >
          {!editingUser.loaded ? (
            <p style={{ color: "var(--muted)" }}>Loading…</p>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  Email
                  <input type="email" value={editingUser.form.email} disabled required />
                </label>
                <label>
                  First Name
                  <input
                    value={editingUser.form.firstName || ""}
                    onChange={(e) => updateForm("firstName", e.target.value)}
                  />
                </label>
                <label>
                  Last Name
                  <input
                    value={editingUser.form.lastName || ""}
                    onChange={(e) => updateForm("lastName", e.target.value)}
                  />
                </label>
                <label>
                  Phone
                  <input
                    type="tel"
                    value={editingUser.form.phone || ""}
                    onChange={(e) => updateForm("phone", e.target.value)}
                    maxLength={40}
                  />
                </label>
                <label>
                  Role
                  <select value={editingUser.form.role} onChange={(e) => updateForm("role", e.target.value)}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                    <option value="guest">Guest (only the trips you choose)</option>
                  </select>
                </label>
              </div>

              <label style={{ display: "block", marginTop: "1rem" }}>
                About them
                <textarea
                  rows={2}
                  value={editingUser.form.profile || ""}
                  maxLength={1000}
                  onChange={(e) => updateForm("profile", e.target.value)}
                />
              </label>

              {editingUser.form.role !== "guest" && (
                <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
                  <label className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={!!editingUser.form.onMissionsTeam}
                      onChange={(e) => updateForm("onMissionsTeam", e.target.checked)}
                    />
                    On the {ownerGroupName} (looks after partners that have no care team)
                  </label>
                </div>
              )}

              {editingUser.form.role === "guest" && (
                <div style={{ marginTop: "1rem" }}>
                  <h4 style={{ margin: "0 0 0.5rem" }}>Trip access</h4>
                  {editingUser.originalRole === "guest" ? (
                    <GuestGrantsPanel userId={editingUser.id} trips={trips} onChanged={reload} />
                  ) : (
                    <TripGrantPicker
                      trips={trips}
                      value={editingUser.form.tripAccess}
                      onChange={(next) => updateForm("tripAccess", next)}
                    />
                  )}
                  {careEnabled && editingUser.originalRole !== "guest" && (
                    <div style={{ marginTop: "1rem" }}>
                      <h4 style={{ margin: "0 0 0.5rem" }}>Care team</h4>
                      <CareSeatPicker
                        partners={partners}
                        value={editingUser.form.careTeam}
                        onChange={(next) => updateForm("careTeam", next)}
                      />
                    </div>
                  )}
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                    A guest can work on these trips and see their partners, nothing else in the app. Changes
                    to an existing guest's trips save immediately.
                  </p>
                </div>
              )}

              <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
                <label>
                  <input
                    type="checkbox"
                    checked={editingUser.form.active}
                    onChange={(e) => updateForm("active", e.target.checked)}
                  />
                  Active
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={editingUser.form.mfaSetupRequired}
                    onChange={(e) => updateForm("mfaSetupRequired", e.target.checked)}
                  />
                  Require Two-Factor Authentication
                </label>
              </div>
              {editingUser.form.mfaEnabled && (
                <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                  This user already has two-factor authentication enabled. Use "Reset MFA" on their row if
                  they need to re-enroll.
                </p>
              )}

              <label style={{ marginTop: "1rem" }}>
                Reset Password (leave blank to keep current)
                <input
                  type="password"
                  value={editingUser.form.password}
                  onChange={(e) => updateForm("password", e.target.value)}
                  minLength={8}
                />
              </label>
            </>
          )}

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </QuickActionModal>
      )}

      {confirmElement}
    </div>
  );
}
