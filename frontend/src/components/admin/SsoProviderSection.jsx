import React, { useEffect, useState } from "react";
import {
  fetchSsoProviderList,
  createSsoProvider,
  updateSsoProvider,
  deleteSsoProvider,
} from "../../api/client.js";

const TYPE_LABELS = { entra: "Entra ID", google: "Google", okta: "Okta", oidc: "Generic OIDC" };

const emptyForm = {
  type: "oidc",
  displayName: "",
  issuerUrl: "",
  clientId: "",
  clientSecret: "",
  allowedDomain: "",
  enabled: true,
};

// One generic OIDC login flow (backend/src/routes/sso.js) serves every
// provider — Entra ID, Google, Okta, or any other standards-compliant IdP.
// Everything a provider needs, including its client secret, lives in this
// one DB-backed form; there's nothing to set in an env var or redeploy for.
export default function SsoProviderSection() {
  const [providers, setProviders] = useState([]);
  const [editingId, setEditingId] = useState(null); // null | "new" | provider id
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    fetchSsoProviderList().then(setProviders).catch(console.error);
  }

  useEffect(reload, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function startAdd() {
    setForm(emptyForm);
    setEditingId("new");
    setError("");
  }

  function startEdit(p) {
    setForm({ ...emptyForm, ...p, clientSecret: "", allowedDomain: p.allowedDomain || "" });
    setEditingId(p.id);
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, allowedDomain: form.allowedDomain || null };
      if (!payload.clientSecret) delete payload.clientSecret; // edit: keeps existing secret unless resetting

      if (editingId === "new") {
        await createSsoProvider(payload);
      } else {
        await updateSsoProvider(editingId, payload);
      }
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save SSO provider");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p) {
    if (!confirm(`Delete "${p.displayName}"? Anyone signed in through it keeps their account, but won't be able to sign in this way again until it's re-added.`)) return;
    await deleteSsoProvider(p.id);
    reload();
  }

  async function handleToggleEnabled(p) {
    await updateSsoProvider(p.id, { enabled: !p.enabled });
    reload();
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Single Sign-On</h3>
        {editingId === null && (
          <button type="button" className="btn secondary small" onClick={startAdd}>
            + Add Provider
          </button>
        )}
      </div>
      <p style={{ marginTop: "0.5rem", color: "#666", fontSize: "0.85rem" }}>
        Optional. Local username/password login always stays available regardless of what's
        configured here. Enabled providers appear as "Sign in with ..." buttons on the login
        page. New users who sign in through one for the first time are auto-created with the
        Editor role — promote them to Admin from Manage Users afterward if needed.
      </p>

      {editingId !== null && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label>
              Provider Type
              <select value={form.type} onChange={(e) => update("type", e.target.value)}>
                <option value="entra">Entra ID (Azure AD)</option>
                <option value="google">Google Workspace</option>
                <option value="okta">Okta</option>
                <option value="oidc">Generic OIDC</option>
              </select>
            </label>
            <label>
              Button Label
              <input
                value={form.displayName}
                onChange={(e) => update("displayName", e.target.value)}
                placeholder="e.g. Entra ID"
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Issuer URL
              <input
                type="url"
                value={form.issuerUrl}
                onChange={(e) => update("issuerUrl", e.target.value)}
                placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
                required
              />
            </label>
            <label>
              Client ID
              <input value={form.clientId} onChange={(e) => update("clientId", e.target.value)} required />
            </label>
            <label>
              Client Secret{editingId !== "new" && " (leave blank to keep current)"}
              <input
                type="password"
                value={form.clientSecret}
                onChange={(e) => update("clientSecret", e.target.value)}
                required={editingId === "new"}
              />
            </label>
            <label>
              Allowed Email Domain (optional)
              <input
                value={form.allowedDomain}
                onChange={(e) => update("allowedDomain", e.target.value)}
                placeholder="yourchurch.org"
              />
            </label>
          </div>
          <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
            <label>
              <input type="checkbox" checked={form.enabled} onChange={(e) => update("enabled", e.target.checked)} />
              Enabled (shows the sign-in button)
            </label>
          </div>
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" className="btn secondary" onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: "1rem" }}>
        {providers.length > 0 ? (
          providers.map((p) => (
            <div key={p.id} className="repeatable-row">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <strong>{p.displayName}</strong>{" "}
                  {p.enabled ? (
                    <span className="status-pill good">Enabled</span>
                  ) : (
                    <span className="status-pill">Disabled</span>
                  )}
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {TYPE_LABELS[p.type] || p.type} · {p.issuerUrl}
                    {p.allowedDomain && ` · restricted to @${p.allowedDomain}`}
                  </div>
                </div>
                <div className="table-actions">
                  <button type="button" className="btn secondary small" onClick={() => handleToggleEnabled(p)}>
                    {p.enabled ? "Disable" : "Enable"}
                  </button>
                  <button type="button" className="btn secondary small" onClick={() => startEdit(p)}>
                    Edit
                  </button>
                  <button type="button" className="btn danger small" onClick={() => handleDelete(p)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No SSO providers configured — local login only.</p>
        )}
      </div>
    </div>
  );
}
