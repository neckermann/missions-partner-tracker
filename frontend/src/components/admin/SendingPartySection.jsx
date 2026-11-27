import React from "react";
import EmailInput from "../../components/shared/EmailInput.jsx";
import PhoneInput from "../../components/shared/PhoneInput.jsx";
import AddressFields from "./AddressFields.jsx";

// `checkbox` is optional, used by the Sending Church instance to fold the "sent by our own
// church" toggle into the same box.
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
            <input
              type="checkbox"
              checked={checkbox.checked}
              onChange={(e) => checkbox.onChange(e.target.checked)}
            />
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
          Contact First Name
          <input
            value={value.contactFirstName || ""}
            onChange={(e) => update("contactFirstName", e.target.value)}
          />
        </label>
        <label>
          Contact Last Name
          <input
            value={value.contactLastName || ""}
            onChange={(e) => update("contactLastName", e.target.value)}
          />
        </label>
        <label>
          Contact Email
          <EmailInput
            value={value.contactEmail || ""}
            onChange={(e) => update("contactEmail", e.target.value)}
          />
        </label>
        <label>
          Phone
          <PhoneInput
            inputMode="tel"
            value={value.phone || ""}
            onChange={(e) => update("phone", e.target.value)}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Website
          <input value={value.websiteLink || ""} onChange={(e) => update("websiteLink", e.target.value)} />
        </label>
      </div>
      <h4>Mailing Address</h4>
      <AddressFields value={value.mailingAddress || {}} onChange={(addr) => update("mailingAddress", addr)} />
    </div>
  );
}
