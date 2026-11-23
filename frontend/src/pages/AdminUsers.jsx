import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  fetchUsers,
  deleteUser,
  sendUserSetupLink,
  fetchCurrentUser,
  resetUserMfa,
  fetchUser,
  updateUser,
  fetchTrips,
} from "../api/client.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import Table from "../components/shared/Table.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import { toDateInputValue } from "../utils/format.js";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";

const emptyForm = {
  email: "",
  firstName: "",
  lastName: "",
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
  scopedTripId: "",
  expiresAt: "",
};

// A user record list, same shape as every other consolidated list page
// (Table, onRowClick -> a QuickActionModal with the edit form) -- not
// EditableSection, which is for sections *within* one record, not a
// collection of many.
//
// Create is the one exception, and lives on its own page
// (AdminUserForm.jsx, "/admin/settings/users/new") rather than a modal
// here: once the welcome-email/password/MFA options (#285) were added on
// top of the basic who-is-this fields, Add User crossed the same "~6
// fields, 2+ conceptual groups" bar Wizard exists for (see
// STYLE-GUIDE.md -- Multi-step creation, and AdminPartnerForm.jsx's own
// field-count survey comment), and a Wizard reads as its own page --
// breadcrumb, title, Cancel/Next pinned to the viewport bottom -- not a
// dialog floating over this list (a popup-modal version shipped briefly
// and was corrected in review for exactly that mismatch with "New
// Partner"). Edit stays the plain QuickActionModal here: it never had the
// welcome-email step, and resetting a password or changing a role is a
// single-topic action.
export default function AdminUsers() {
  const location = useLocation();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [trips, setTrips] = useState([]);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState(null); // { id, form } for edit
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");
  const [manualSetupLink, setManualSetupLink] = useState(null); // { name, email, url } | null

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
  }, []);

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
    // `loaded: false` keeps the modal's real, interactive form from
    // rendering at all until fetchUser resolves -- this used to render
    // the form immediately against `emptyForm` as a loading stand-in, but
    // emptyForm is a real, editable form, not an inert placeholder: a
    // change made in that window (role, name, ...) was silently
    // overwritten the moment the fetch below landed and replaced the
    // whole form with the server's own data, discarding whatever was just
    // typed/selected with no error or indication anything was lost. Confirmed
    // as the actual cause of this suite's own "edit sticks" test going
    // flaky in CI (never locally, where the fetch resolves long before a
    // person or Playwright could react) -- not a timing issue to paper
    // over in the test, a real bug any slow connection could hit.
    setEditingUser({ id: u.id, form: emptyForm, loaded: false });
    try {
      const full = await fetchUser(u.id);
      setEditingUser({
        id: u.id,
        loaded: true,
        form: {
          ...emptyForm,
          ...full,
          password: "",
          scopedTripId: full.scopedTripId || "",
          expiresAt: toDateInputValue(full.expiresAt) || "",
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
    const { id, form } = editingUser;
    const payload = {
      ...form,
      scopedTripId: form.role === "tripLeader" ? form.scopedTripId || null : null,
      expiresAt: form.role === "tripLeader" && form.expiresAt ? form.expiresAt : null,
    };
    if (!payload.password) delete payload.password;

    // sendWelcomeEmail/requireMfa only exist on create.
    const { email, authProvider, sendWelcomeEmail, requireMfa, ...updatable } = payload;
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
          {u.role === "tripLeader" ? "Trip Leader" : u.role}
          {u.scopedTrip && (
            <div style={{ fontSize: "0.75rem", color: "#888" }}>
              {[u.scopedTrip.partner?.displayName, u.scopedTrip.name || u.scopedTrip.type]
                .filter(Boolean)
                .join(" — ")}
            </div>
          )}
        </>
      ),
    },
    { key: "authProvider", label: "Auth" },
    {
      key: "active",
      label: "Active",
      render: (u) =>
        u.passwordSetupPending ? (
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
      {manualSetupLink && <ManualSendNotice recipients={manualSetupLink} />}

      <Table
        columns={columns}
        rows={users}
        onRowClick={openEdit}
        emptyMessage="No users yet."
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
            <p style={{ color: "#888" }}>Loading…</p>
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
                  Role
                  <select value={editingUser.form.role} onChange={(e) => updateForm("role", e.target.value)}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                    <option value="tripLeader">Trip Leader (scoped guest)</option>
                  </select>
                </label>
              </div>

              {editingUser.form.role === "tripLeader" && (
                <div className="form-grid" style={{ marginTop: "1rem" }}>
                  <label>
                    Trip
                    <select
                      value={editingUser.form.scopedTripId}
                      onChange={(e) => updateForm("scopedTripId", e.target.value)}
                      required
                    >
                      <option value="">Choose a trip…</option>
                      {trips.map((t) => (
                        <option key={t.id} value={t.id}>
                          {[t.partner?.displayName, t.name || t.type, t.startDate?.slice(0, 10)]
                            .filter(Boolean)
                            .join(" — ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Access expires (optional)
                    <input
                      type="date"
                      value={editingUser.form.expiresAt}
                      onChange={(e) => updateForm("expiresAt", e.target.value)}
                    />
                  </label>
                </div>
              )}
              {editingUser.form.role === "tripLeader" && (
                <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
                  A scoped guest login: read/write access to this one trip's own content and a read-only look
                  at its linked partner, nothing else in the app.
                </p>
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
                <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
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
