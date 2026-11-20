import React, { useEffect, useState } from "react";
import { updateChurchSettings, syncAllSendingChurch, uploadChurchLogo } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import AddressFields from "../components/admin/AddressFields.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";

const emptyAddress = {
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateProvinceRegion: "",
  postalCode: "",
  country: "",
};

const emptyForm = {
  churchName: "",
  phone: "",
  contactFirstName: "",
  contactLastName: "",
  contactEmail: "",
  websiteLink: "",
  timezone: "UTC",
  ...emptyAddress,
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

const TIMEZONES = Intl.supportedValuesOf("timeZone");

const FONT_OPTIONS = [
  { value: "", label: "System Default" },
  { value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', label: "System Sans" },
  { value: 'Georgia, "Times New Roman", serif', label: "Classic Serif" },
  { value: '"Helvetica Neue", Arial, sans-serif', label: "Modern Sans" },
  { value: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif', label: "Elegant Serif" },
  { value: '"Trebuchet MS", Verdana, sans-serif', label: "Friendly Sans" },
];

function mergeFetchedRecord(s) {
  if (!s?.id) return emptyForm;
  return { ...emptyForm, ...s, logo: s.logo || {} };
}

export default function AdminSettingsAbout() {
  const { refreshSettings } = useSettings();
  const [form, setForm] = useState(emptyForm);
  const [sentByOurChurchCount, setSentByOurChurchCount] = useState(0);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState("");
  const [error, setError] = useState("");

  const { settings, error: settingsError } = useChurchSettings();
  useEffect(() => {
    if (settings) {
      setForm(mergeFetchedRecord(settings));
      setSentByOurChurchCount(settings?.sentByOurChurchCount || 0);
    }
  }, [settings]);
  useEffect(() => {
    if (settingsError) setError("Couldn't load church settings.");
  }, [settingsError]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSuccess("");
    setSyncSuccess("");
    setError("");
  }

  function handleResetBranding() {
    setForm((f) => ({ ...f, headerColor: "", primaryColor: "", highlightColor: "", brandFont: "" }));
    setSuccess("");
    setError("");
  }

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
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
    setSyncSuccess("");
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
      refreshSettings();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncAll() {
    setSyncing(true);
    setSyncSuccess("");
    setError("");
    try {
      const { updatedCount } = await syncAllSendingChurch();
      setSyncSuccess(`Updated ${updatedCount} partner${updatedCount === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't update partners with this info.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <SettingsPageHeader title="About & Branding" />
      <p style={{ color: "#555" }}>
        Church info, contact details, and how this church presents itself — public-site tagline, about text,
        brand colors, font, logo, and what to call its partners.
      </p>

      <form onSubmit={handleSubmit} className="admin-form">
        <div className="admin-section">
          <h3>Church Info</h3>
          <div className="form-grid">
            <label>
              Church Name
              <input value={form.churchName || ""} onChange={(e) => update("churchName", e.target.value)} />
            </label>
            <label>
              Phone
              <input
                value={form.phone || ""}
                onChange={(e) => update("phone", e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Contact First Name
              <input
                value={form.contactFirstName || ""}
                onChange={(e) => update("contactFirstName", e.target.value)}
              />
            </label>
            <label>
              Contact Last Name
              <input
                value={form.contactLastName || ""}
                onChange={(e) => update("contactLastName", e.target.value)}
              />
            </label>
            <label>
              Contact Email
              <input
                value={form.contactEmail || ""}
                onChange={(e) => update("contactEmail", e.target.value)}
              />
            </label>
            <label>
              Website
              <input value={form.websiteLink || ""} onChange={(e) => update("websiteLink", e.target.value)} />
            </label>
            <label>
              Timezone
              <select value={form.timezone || "UTC"} onChange={(e) => update("timezone", e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ color: "#666", fontSize: "0.85rem", marginTop: "-0.5rem" }}>
            Drives every scheduled send in this app (email digests, GroupMe) so "send at 9" actually means 9am
            here, not UTC. Changing this takes effect the next time the app restarts, not instantly.
          </p>
          <h4>Address</h4>
          <AddressFields
            value={{
              addressLine1: form.addressLine1,
              addressLine2: form.addressLine2,
              city: form.city,
              stateProvinceRegion: form.stateProvinceRegion,
              postalCode: form.postalCode,
              country: form.country,
            }}
            onChange={(addr) => {
              setForm((f) => ({ ...f, ...addr }));
              setSuccess("");
              setSyncSuccess("");
              setError("");
            }}
          />
        </div>

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
          {success && sentByOurChurchCount > 0 && (
            <>
              <span style={{ color: "#555" }}>
                {sentByOurChurchCount} partner{sentByOurChurchCount === 1 ? "" : "s"} marked &ldquo;Sent by
                our church.&rdquo;
              </span>
              <button
                type="button"
                className="btn secondary small"
                onClick={handleSyncAll}
                disabled={syncing}
              >
                {syncing ? "Updating..." : "Update them all with this info"}
              </button>
            </>
          )}
          {syncSuccess && <span style={{ color: "#2a5d3c" }}>{syncSuccess}</span>}
        </div>
      </form>
    </div>
  );
}
