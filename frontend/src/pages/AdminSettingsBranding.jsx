import React, { useEffect, useState } from "react";
import { fetchChurchSettings, updateChurchSettings, uploadChurchLogo } from "../api/client.js";

const emptyForm = {
  partnerTermSingular: "",
  partnerTermPlural: "",
  usePartnerTermInAdmin: false,
  publicTagline: "",
  aboutText: "",
  primaryColor: "",
  logo: {},
};

// See the same note in AdminSettingsAbout.jsx -- `s?.id` (not `!s`) is the
// "has this church configured anything yet" check, and this only pulls in
// the fields this page owns so saving here never touches the other Site
// Administration pages' fields.
function mergeFetchedRecord(s) {
  if (!s?.id) return emptyForm;
  return {
    ...emptyForm,
    ...s,
    logo: s.logo || {},
  };
}

export default function AdminSettingsBranding() {
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchChurchSettings().then((s) => setForm(mergeFetchedRecord(s)));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSuccess("");
  }

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setSuccess("");
  }

  function handleRemoveImage() {
    setImageFile(null);
    setImagePreview(null);
    update("logo", null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    try {
      let updated = await updateChurchSettings(form);
      if (imageFile) {
        updated = await uploadChurchLogo(imageFile);
      }
      setForm(mergeFetchedRecord(updated));
      setImageFile(null);
      setImagePreview(null);
      setSuccess("Saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>Branding</h2>
      <p style={{ color: "#555" }}>
        How this church presents itself — public-site tagline, about text, brand color, logo, and
        what to call its partners.
      </p>

      <form onSubmit={handleSubmit} className="admin-form">
        <div className="admin-section">
          <h3>Public Site</h3>
          <label>
            Tagline
            <input
              value={form.publicTagline || ""}
              onChange={(e) => update("publicTagline", e.target.value)}
              placeholder="e.g. Prayer & Support Directory"
            />
          </label>
          <label style={{ marginTop: "1rem" }}>
            About
            <textarea
              rows={4}
              value={form.aboutText || ""}
              onChange={(e) => update("aboutText", e.target.value)}
              placeholder="An optional blurb shown on the public partner directory."
            />
          </label>
          <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
            Brand Color
            <input
              type="color"
              value={form.primaryColor || "#2a5d3c"}
              onChange={(e) => update("primaryColor", e.target.value)}
            />
          </label>
        </div>

        <div className="admin-section">
          <h3>Logo</h3>
          <div className="headshot-row">
            {(imagePreview || form.logo?.url) && (
              <img
                src={imagePreview || form.logo.url}
                alt="Logo preview"
                className="missionary-thumb"
                style={{ width: 80, height: 80 }}
              />
            )}
            <label style={{ flex: 1 }}>
              Logo Image
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} />
            </label>
            {(imagePreview || form.logo?.url) && (
              <button type="button" className="btn secondary small" onClick={handleRemoveImage}>
                Remove logo
              </button>
            )}
          </div>
        </div>

        <div className="admin-section">
          <h3>Partner Terminology</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: "0.85rem" }}>
            What this church calls its missionary and organization partners — e.g. "Go Team
            Partner" / "Go Team Partners". Used on the public site regardless of whether a
            partner is an individual/family or an organization. Leave blank to keep the
            default "Missionary" / "Missionaries" wording.
          </p>
          <div className="form-grid">
            <label>
              Singular
              <input
                value={form.partnerTermSingular || ""}
                onChange={(e) => update("partnerTermSingular", e.target.value)}
                placeholder="Missionary"
              />
            </label>
            <label>
              Plural
              <input
                value={form.partnerTermPlural || ""}
                onChange={(e) => update("partnerTermPlural", e.target.value)}
                placeholder="Missionaries"
              />
            </label>
          </div>
          <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
            <label>
              <input
                type="checkbox"
                checked={form.usePartnerTermInAdmin}
                onChange={(e) => update("usePartnerTermInAdmin", e.target.checked)}
              />
              Also use this term in the admin interface (nav/list headings)
            </label>
          </div>
        </div>

        <div className="form-save-bar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {success && <span style={{ color: "#2a5d3c" }}>{success}</span>}
        </div>
      </form>
    </div>
  );
}
