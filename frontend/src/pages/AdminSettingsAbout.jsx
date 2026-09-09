import React, { useEffect, useState } from "react";
import { fetchChurchSettings, updateChurchSettings } from "../api/client.js";
import AddressFields from "../components/admin/AddressFields.jsx";

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
  contactName: "",
  contactEmail: "",
  websiteLink: "",
  address: { ...emptyAddress },
};

// Settings is a singleton — GET returns { featureRegistry } with everything
// else absent before it's ever been saved (see routes/settings.js), so
// `s?.id` (not `!s`) is the actual "has this church configured anything
// yet" check — same pattern as the other Site Administration pages. Only
// pulls in the fields this page owns -- Branding/Features/SSO/Users are
// separate pages under the sidebar's Site Administration group (see
// AdminSidebar.jsx), each PUTting just its own slice, so saving here never
// touches the others' fields.
function mergeFetchedRecord(s) {
  if (!s?.id) return emptyForm;
  return {
    ...emptyForm,
    ...s,
    address: { ...emptyForm.address, ...(s.address || {}) },
  };
}

export default function AdminSettingsAbout() {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchChurchSettings().then((s) => setForm(mergeFetchedRecord(s)));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSuccess("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess("");
    try {
      const updated = await updateChurchSettings(form);
      setForm(mergeFetchedRecord(updated));
      setSuccess("Saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>About Church</h2>
      <p style={{ color: "#555" }}>
        Basic church info — used to auto-fill the Sending Church section when this church is the
        sender, and for contact details shown across the admin app.
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
              <input value={form.phone || ""} onChange={(e) => update("phone", e.target.value)} />
            </label>
            <label>
              Contact Name
              <input value={form.contactName || ""} onChange={(e) => update("contactName", e.target.value)} />
            </label>
            <label>
              Contact Email
              <input value={form.contactEmail || ""} onChange={(e) => update("contactEmail", e.target.value)} />
            </label>
            <label>
              Website
              <input value={form.websiteLink || ""} onChange={(e) => update("websiteLink", e.target.value)} />
            </label>
          </div>
          <h4>Address</h4>
          <AddressFields value={form.address} onChange={(addr) => update("address", addr)} />
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
