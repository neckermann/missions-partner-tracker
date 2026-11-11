import React, { useEffect, useState } from "react";
import { updateChurchSettings, uploadChurchLogo } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";

const emptyForm = {
  partnerTermSingular: "",
  partnerTermPlural: "",
  usePartnerTermInAdmin: false,
  publicTagline: "",
  aboutText: "",
  primaryColor: "",
  headerColor: "",
  highlightColor: "",
  brandFont: "",
  logo: {},
};

// Reuses the exact font stacks already proven in booklet.css's own
// templates -- zero new font-loading risk, visual consistency with the
// existing printable booklet. Empty string = "use the app's own default,"
// same as how every color field here leaves itself blank rather than
// writing the fallback's literal value into the row.
const FONT_OPTIONS = [
  { value: "", label: "System Default" },
  { value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', label: "System Sans" },
  { value: 'Georgia, "Times New Roman", serif', label: "Classic Serif" },
  { value: '"Helvetica Neue", Arial, sans-serif', label: "Modern Sans" },
  { value: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif', label: "Elegant Serif" },
  { value: '"Trebuchet MS", Verdana, sans-serif', label: "Friendly Sans" },
];

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
  const { refreshSettings } = useSettings();
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const { settings, error: settingsError } = useChurchSettings();
  useEffect(() => {
    if (settings) setForm(mergeFetchedRecord(settings));
  }, [settings]);
  useEffect(() => {
    if (settingsError) setError("Couldn't load branding settings.");
  }, [settingsError]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSuccess("");
    setError("");
  }

  // Clears the four brand fields back to "use the app's own default" --
  // same blank-means-default convention every field here already follows.
  // Only stages the change in form state, same as every other field;
  // still requires Save to actually persist, so it's easy to back out of.
  function handleResetBranding() {
    setForm((f) => ({ ...f, headerColor: "", primaryColor: "", highlightColor: "", brandFont: "" }));
    setSuccess("");
    setError("");
  }

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    // A blob: URL (URL.createObjectURL) is blocked by this app's CSP --
    // img-src only allows 'self', data:, and the map tile hosts, no blob:.
    // A data: URL from FileReader renders fine under that same policy.
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
    setSuccess("");
    setError("");
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
    setError("");
    try {
      let updated = await updateChurchSettings(form);
      if (imageFile) {
        updated = await uploadChurchLogo(imageFile);
      }
      setForm(mergeFetchedRecord(updated));
      setImageFile(null);
      setImagePreview(null);
      setSuccess("Saved.");
      // Without this, a saved color/font change is invisible anywhere else
      // in the app (sidebar, buttons, public pages) until a hard reload --
      // SettingsContext only fetches once on mount otherwise.
      refreshSettings();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save branding settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>Branding</h2>
      <p style={{ color: "#555" }}>
        How this church presents itself — public-site tagline, about text, brand colors, font, logo, and what
        to call its partners.
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
            Header Color
            <input
              type="color"
              value={form.headerColor || "#2c2a28"}
              onChange={(e) => update("headerColor", e.target.value)}
            />
          </label>
          <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            The header bar and admin sidebar background.
          </p>
          <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
            Accent Color
            <input
              type="color"
              value={form.primaryColor || "#2a5d3c"}
              onChange={(e) => update("primaryColor", e.target.value)}
            />
          </label>
          <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            Buttons, links, headings, and report letterheads -- the color people associate with this church.
          </p>
          <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
            Highlight Color
            <input
              type="color"
              value={form.highlightColor || "#a6540f"}
              onChange={(e) => update("highlightColor", e.target.value)}
            />
          </label>
          <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            Hover, focus, and active/selected states -- e.g. a button on hover, the current nav item.
          </p>
          <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
            Font
            <select
              value={form.brandFont || ""}
              onChange={(e) => update("brandFont", e.target.value || null)}
            >
              {FONT_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="btn secondary small" onClick={handleResetBranding}>
              Reset to Default
            </button>
          </div>
        </div>

        <div className="admin-section">
          <h3>Logo</h3>
          <div className="headshot-row">
            {(imagePreview || form.logo?.url) && (
              <img
                src={imagePreview || form.logo.url}
                alt="Logo preview"
                className="logo-preview"
                style={{ background: form.headerColor || "#2c2a28" }}
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
            What this church calls its missionary and organization partners — e.g. "Go Team Partner" / "Go
            Team Partners". Used on the public site regardless of whether a partner is an individual/family or
            an organization. Leave blank to keep the default "Missionary" / "Missionaries" wording.
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
          {error && (
            <span style={{ color: "#b91c1c" }} role="alert">
              {error}
            </span>
          )}
          {success && <span style={{ color: "#2a5d3c" }}>{success}</span>}
        </div>
      </form>
    </div>
  );
}
