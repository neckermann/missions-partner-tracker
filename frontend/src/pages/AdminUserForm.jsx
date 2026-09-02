import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchUser, createUser, updateUser } from "../api/client.js";

const emptyForm = {
  email: "",
  name: "",
  role: "editor",
  authProvider: "local",
  active: true,
  password: "",
  mfaSetupRequired: false,
};

export default function AdminUserForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isEdit) {
      fetchUser(id).then((u) => setForm({ ...emptyForm, ...u, password: "" }));
    }
  }, [id]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = { ...form };
    if (!payload.password) delete payload.password; // create: not required if SSO; edit: keeps existing password unless resetting

    try {
      if (isEdit) {
        const { email, authProvider, ...updatable } = payload;
        await updateUser(id, updatable);
      } else {
        await createUser(payload);
      }
      navigate("/admin/users");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell">
      <h2>{isEdit ? "Edit User" : "Add User"}</h2>
      <form onSubmit={handleSubmit} className="admin-form">
        <div className="admin-section">
          <div className="form-grid">
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                disabled={isEdit}
                required
              />
            </label>
            <label>
              Name
              <input value={form.name || ""} onChange={(e) => update("name", e.target.value)} />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(e) => update("role", e.target.value)}>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <label>
              Auth Provider
              <select value={form.authProvider} onChange={(e) => update("authProvider", e.target.value)} disabled={isEdit}>
                <option value="local">Local (username/password)</option>
                <option value="sso">Single Sign-On (SSO)</option>
              </select>
            </label>
          </div>

          {isEdit && (
            <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
              <label>
                <input type="checkbox" checked={form.active} onChange={(e) => update("active", e.target.checked)} />
                Active
              </label>
              {form.authProvider === "local" && (
                <label>
                  <input
                    type="checkbox"
                    checked={form.mfaSetupRequired}
                    onChange={(e) => update("mfaSetupRequired", e.target.checked)}
                  />
                  Require Two-Factor Authentication
                </label>
              )}
            </div>
          )}
          {form.mfaEnabled && (
            <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
              This user already has two-factor authentication enabled. Use "Reset MFA" on the
              Users list if they need to re-enroll.
            </p>
          )}

          {form.authProvider === "local" && (
            <label style={{ marginTop: "1rem" }}>
              {isEdit ? "Reset Password (leave blank to keep current)" : "Password"}
              <input
                type="password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                required={!isEdit}
                minLength={8}
              />
            </label>
          )}

          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        </div>

        <div>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="btn secondary" style={{ marginLeft: "0.5rem" }} onClick={() => navigate("/admin/users")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
