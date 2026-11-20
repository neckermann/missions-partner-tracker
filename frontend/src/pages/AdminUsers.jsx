import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchUsers, deleteUser, fetchCurrentUser, resetUserMfa } from "../api/client.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

export default function AdminUsers() {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [error, setError] = useState("");

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  function reload() {
    fetchUsers().then(setUsers).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchCurrentUser().then(setCurrentUser);
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

      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Auth</th>
            <th>Active</th>
            <th>MFA</th>
            <th>Last Login</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{[u.firstName, u.lastName].filter(Boolean).join(" ")}</td>
              <td>{u.role}</td>
              <td>{u.authProvider}</td>
              <td>{u.active ? "Yes" : "No"}</td>
              <td>
                {u.authProvider !== "local" ? (
                  "—"
                ) : u.mfaEnabled ? (
                  <span className="status-pill good">Enabled</span>
                ) : u.mfaSetupRequired ? (
                  <span className="status-pill warn">Required</span>
                ) : (
                  <span className="status-pill">Off</span>
                )}
              </td>
              <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}</td>
              <td className="table-actions">
                <Link to={`/admin/settings/users/${u.id}`}>Edit</Link>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confirmElement}
    </div>
  );
}
