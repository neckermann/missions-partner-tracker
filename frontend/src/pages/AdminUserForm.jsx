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
  // Only meaningful in edit mode -- create mode has nothing to fetch, so
  // starts false there. Guards two real risks of a slow/failed edit-mode
  // fetch: clicking Save before it resolves would submit the still-blank
  // emptyForm defaults over the real user's name/role/active/MFA flags,
  // and a failed fetch with no .catch left the form silently showing (and
  // submittable with) those same blank defaults.
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (isEdit) {
      setLoading(true);
      setLoadError("");
      fetchUser(id)
        .then((u) => setForm({ ...emptyForm, ...u, password: "" }))
        .catch(() => setLoadError("Couldn't load this user."))
        .finally(() => setLoading(false));
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
    // Only meaningful when editing: a blank field means "keep the current
    // password". Creating requires one (enforced by the input and the API).
    if (!payload.password) delete payload.password;

    try {
      if (isEdit) {
        const { email, authProvider, ...updatable } = payload;
        await updateUser(id, updatable);
      } else {
        await createUser(payload);
      }
      navigate("/admin/settings/users");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save user");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  // No form at all on a failed load -- rendering it anyway, even
  // disabled, risks the blank emptyForm defaults reaching handleSubmit
  // some other way later. An error with a way back is the safe option.
  if (loadError) {
    return (
      <div className="admin-shell">
        <h2>Edit User</h2>
        <p style={{ color: "#b91c1c" }} role="alert">
          {loadError}
        </p>
        <button type="button" className="btn secondary" onClick={() => navigate("/admin/settings/users")}>
          Back to Users
        </button>
      </div>
    );
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
          </div>

          {isEdit && (
            <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
              <label>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => update("active", e.target.checked)}
                />
                Active
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.mfaSetupRequired}
                  onChange={(e) => update("mfaSetupRequired", e.target.checked)}
                />
                Require Two-Factor Authentication
              </label>
            </div>
          )}
          {form.mfaEnabled && (
            <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.5rem" }}>
              This user already has two-factor authentication enabled. Use "Reset MFA" on the Users list if
              they need to re-enroll.
            </p>
          )}

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

          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        </div>

        <div>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="btn secondary"
            style={{ marginLeft: "0.5rem" }}
            onClick={() => navigate("/admin/settings/users")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
