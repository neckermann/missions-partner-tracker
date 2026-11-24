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
  const [partners, setPartners] = useState([]);
  const { enabledFeatures } = useSettings();
  const careEnabled = !!enabledFeatures?.careTeam;
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState(null); // { id, form } for edit
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");
  const [manualSetupLink, setManualSetupLink] = useState(null); // { name, email, url } | null
  // Guests whose access has lapsed or been removed, so an admin can reach
  // out and clean up (#356). Filtered here from the list's own
  // `inactiveReason` rather than refetching.
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
              <div key={g.id} style={{ fontSize: "0.75rem", color: g.active ? "#888" : "var(--danger)" }}>
                {[g.trip.partner?.displayName, g.trip.name || g.trip.type].filter(Boolean).join(" — ") ||
                  "Trip"}
                {g.effectiveExpiresAt &&
                  ` · ${g.active ? "until" : "ended"} ${formatUtcDate(g.effectiveExpiresAt)}`}
              </div>
            ))}
          {u.careTeamSeats?.map((seat) => (
            <div key={seat.id} style={{ fontSize: "0.75rem", color: "#888" }}>
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

      {(inactiveCount > 0 || inactiveOnly) && (
        <div className="admin-checkbox-row" style={{ marginBottom: "0.5rem" }}>
          <label>
            <input
              type="checkbox"
              checked={inactiveOnly}
              onChange={(e) => setInactiveOnly(e.target.checked)}
            />
            Inactive accounts only ({inactiveCount}) -- guests whose access has ended or been removed
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
                    <option value="guest">Guest (only the trips you choose)</option>
                  </select>
                </label>
              </div>

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
                  <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
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
                    checked={editingUser.form.role === "guest" || editingUser.form.mfaSetupRequired}
                    disabled={editingUser.form.role === "guest"}
                    onChange={(e) => updateForm("mfaSetupRequired", e.target.checked)}
                  />
                  Require Two-Factor Authentication
                  {editingUser.form.role === "guest" && " (always required for guests)"}
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
