import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchUsers, deleteUser, fetchCurrentUser, resetUserMfa } from "../api/client.js";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  function reload() {
    fetchUsers().then(setUsers).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchCurrentUser().then(setCurrentUser);
  }, []);

  async function handleDelete(id, email) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    try {
      await deleteUser(id);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete user");
    }
  }

  // Recovery path for a lost/broken authenticator device — clears MFA so
  // the user can log in with just their password and re-enroll themselves.
  async function handleResetMfa(id, email) {
    if (!confirm(`Reset two-factor authentication for ${email}? They will need to re-enroll.`)) return;
    try {
      await resetUserMfa(id);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to reset MFA");
    }
  }

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Users ({users.length})</h2>
        <Link to="/admin/users/new" className="btn">+ Add User</Link>
      </div>

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
                <td>{u.name}</td>
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
                  <Link to={`/admin/users/${u.id}`}>Edit</Link>
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
    </div>
  );
}
