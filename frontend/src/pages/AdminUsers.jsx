import React, { useEffect, useState } from "react";
import {
  fetchUsers,
  deleteUser,
  sendUserSetupLink,
  fetchCurrentUser,
  resetUserMfa,
  fetchUser,
  createUser,
  updateUser,
  fetchTrips,
} from "../api/client.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import Table from "../components/shared/Table.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Modal from "../components/Modal.jsx";
import Wizard from "../components/shared/Wizard.jsx";
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
// collection of many. The dedicated /new and /:id routes AdminUserForm.jsx
// used to own are gone; everything happens from this one page now.
//
// Create is the one exception: once the welcome-email/password/MFA options
// (#285) were added on top of the basic who-is-this fields, this crossed
// the same "~6 fields, 2+ conceptual groups" bar Wizard exists for (see
// STYLE-GUIDE.md -- Multi-step creation, and AdminPartnerForm.jsx's own
// field-count survey comment) -- Basics vs. Account Setup. Edit stays the
// plain QuickActionModal: it never had the welcome-email step to begin
// with, and resetting a password or changing a role is a single-topic
// action.
export default function AdminUsers() {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [trips, setTrips] = useState([]);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState(null); // { id, form } for edit
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  // Set only when the account the wizard just created needs a manual
  // setup link (outbound email is off) -- shown as the wizard's own last
  // step, in the same modal, instead of closing and hoping the admin
  // notices the page-level notice behind it.
  const [createManualLink, setCreateManualLink] = useState(null); // { email, url } | null
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
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

  function openCreate() {
    setFormError("");
    setCreateManualLink(null);
    setShowCreate(true);
  }

  function closeCreate() {
    setShowCreate(false);
    setCreateManualLink(null);
  }

  async function openEdit(u) {
    setFormError("");
    setEditingUser({ id: u.id, form: emptyForm }); // show the modal immediately, loading state implicit
    try {
      const full = await fetchUser(u.id);
      setEditingUser({
        id: u.id,
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

  async function handleCreateFinish(values) {
    setCreating(true);
    setFormError("");
    try {
      const payload = {
        ...values,
        scopedTripId: values.role === "tripLeader" ? values.scopedTripId || null : null,
        expiresAt: values.role === "tripLeader" && values.expiresAt ? values.expiresAt : null,
      };
      if (!payload.password) delete payload.password;

      const created = await createUser(payload);
      reload();
      if (created.welcomeEmail?.manualSetupUrl) {
        // Outbound email is off -- stay open and hand the admin the link
        // right here, rather than closing and hoping they notice it on
        // the page behind the modal.
        setCreateManualLink({ email: created.email, url: created.welcomeEmail.manualSetupUrl });
        return;
      }
      if (created.welcomeEmail && !created.welcomeEmail.sent && !created.welcomeEmail.skipped) {
        setError(
          `${created.email} was created, but the welcome email couldn't be sent (${created.welcomeEmail.error}). Use "Send setup link" on their row to try again.`
        );
      }
      setShowCreate(false);
    } catch (err) {
      setFormError(mapServerErrorMessage(err?.response?.data?.error) || "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  const createSteps = [
    {
      key: "basics",
      label: "Basics",
      validate: (values) => {
        if (!values.email.trim()) return "Email is required.";
        if (values.role === "tripLeader" && !values.scopedTripId) {
          return "Choose a trip for this Trip Leader.";
        }
        return null;
      },
      render: ({ values, setValue }) => (
        <>
          <div className="form-grid">
            <label>
              Email
              <input
                type="email"
                value={values.email}
                onChange={(e) => setValue("email", e.target.value)}
                required
              />
            </label>
            <label>
              First Name
              <input value={values.firstName} onChange={(e) => setValue("firstName", e.target.value)} />
            </label>
            <label>
              Last Name
              <input value={values.lastName} onChange={(e) => setValue("lastName", e.target.value)} />
            </label>
            <label>
              Role
              <select value={values.role} onChange={(e) => setValue("role", e.target.value)}>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
                <option value="tripLeader">Trip Leader (scoped guest)</option>
              </select>
            </label>
          </div>

          {values.role === "tripLeader" && (
            <div className="form-grid" style={{ marginTop: "1rem" }}>
              <label>
                Trip
                <select
                  value={values.scopedTripId}
                  onChange={(e) => setValue("scopedTripId", e.target.value)}
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
                  value={values.expiresAt}
                  onChange={(e) => setValue("expiresAt", e.target.value)}
                />
              </label>
            </div>
          )}
          {values.role === "tripLeader" && (
            <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
              A scoped guest login: read/write access to this one trip's own content and a read-only look at
              its linked partner, nothing else in the app.
            </p>
          )}
        </>
      ),
    },
    {
      key: "access",
      label: "Account Setup",
      validate: (values) => {
        if (!values.sendWelcomeEmail && values.password && values.password.length < 8) {
          return "Password must be at least 8 characters.";
        }
        return null;
      },
      render: ({ values, setValue }) => (
        <>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={values.sendWelcomeEmail}
                onChange={(e) => setValue("sendWelcomeEmail", e.target.checked)}
              />
              Send a welcome email so they can set their own password (recommended)
            </label>
            <label>
              <input
                type="checkbox"
                checked={values.requireMfa}
                onChange={(e) => setValue("requireMfa", e.target.checked)}
              />
              Require two-factor authentication at first sign-in
            </label>
          </div>
          <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
            {values.sendWelcomeEmail
              ? "They'll get a one-time link to choose their own password. Nobody else ever sees it."
              : 'No email is sent. Set a password below, or leave it blank and use "Send setup link" on their row later. Until a password is set they can\'t sign in.'}
          </p>
          {!values.sendWelcomeEmail && (
            <label style={{ marginTop: "1rem" }}>
              Password (optional)
              <input
                type="password"
                value={values.password}
                onChange={(e) => setValue("password", e.target.value)}
                minLength={8}
              />
            </label>
          )}
        </>
      ),
    },
  ];

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
          <button type="button" className="btn" onClick={openCreate}>
            + Add User
          </button>
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
        <QuickActionModal title="Edit User" onClose={() => setEditingUser(null)} onSubmit={handleSaveUser}>
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
              A scoped guest login: read/write access to this one trip's own content and a read-only look at
              its linked partner, nothing else in the app.
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
              This user already has two-factor authentication enabled. Use "Reset MFA" on their row if they
              need to re-enroll.
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

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </QuickActionModal>
      )}

      {showCreate && (
        <Modal title="Add User" onClose={closeCreate}>
          {createManualLink ? (
            <>
              <p>
                {createManualLink.email} was created. Outbound email is off, so share this setup link with
                them directly instead:
              </p>
              <ManualSendNotice recipients={createManualLink} />
              <div style={{ marginTop: "1rem" }}>
                <button type="button" className="btn" onClick={closeCreate}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <Wizard
              steps={createSteps}
              initialValues={emptyForm}
              onFinish={handleCreateFinish}
              onCancel={closeCreate}
              finishing={creating}
            />
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </Modal>
      )}

      {confirmElement}
    </div>
  );
}
