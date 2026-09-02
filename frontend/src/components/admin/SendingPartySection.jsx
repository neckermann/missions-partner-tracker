import React from "react";
import AddressFields from "./AddressFields.jsx";

// `checkbox` is optional — used by the Sending Church instance only, to
// fold the "sent by our own church" toggle into the same box as the
// church's own details instead of a separate section above it.
export default function SendingPartySection({ title, value, onChange, checkbox }) {
  function update(field, val) {
    onChange({ ...value, [field]: val });
  }

  return (
    <div className="admin-section">
      <h3>{title}</h3>
      {checkbox && (
        <div className="admin-checkbox-row" style={{ marginBottom: "1.25rem" }}>
          <label>
            <input type="checkbox" checked={checkbox.checked} onChange={(e) => checkbox.onChange(e.target.checked)} />
            {checkbox.label}
          </label>
        </div>
      )}
      <div className="form-grid">
        <label>
          Name
          <input value={value.name || ""} onChange={(e) => update("name", e.target.value)} />
        </label>
        <label>
          Contact Name
          <input value={value.contactName || ""} onChange={(e) => update("contactName", e.target.value)} />
        </label>
        <label>
          Contact Email
          <input value={value.contactEmail || ""} onChange={(e) => update("contactEmail", e.target.value)} />
        </label>
        <label>
          Phone
          <input value={value.phone || ""} onChange={(e) => update("phone", e.target.value)} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Website
          <input value={value.websiteLink || ""} onChange={(e) => update("websiteLink", e.target.value)} />
        </label>
      </div>
      <h4>Mailing Address</h4>
      <AddressFields
        value={value.mailingAddress || {}}
        onChange={(addr) => update("mailingAddress", addr)}
      />
    </div>
  );
}
