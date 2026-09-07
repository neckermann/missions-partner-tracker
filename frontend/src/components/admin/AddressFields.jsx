import React from "react";
import { COUNTRY_CONTINENTS } from "../../utils/countryContinents.js";

const COUNTRY_NAMES = Object.keys(COUNTRY_CONTINENTS).sort();

export default function AddressFields({ value, onChange, showMailFlags = false, showGps = false, idPrefix = "address" }) {
  function update(field, val) {
    onChange({ ...value, [field]: val });
  }

  return (
    <div className="form-grid">
      {showGps && (
        <>
          <label>
            GPS Latitude
            <input
              type="number"
              step="any"
              value={value.gpsLat ?? ""}
              onChange={(e) => update("gpsLat", e.target.value === "" ? null : e.target.value)}
            />
          </label>
          <label>
            GPS Longitude
            <input
              type="number"
              step="any"
              value={value.gpsLng ?? ""}
              onChange={(e) => update("gpsLng", e.target.value === "" ? null : e.target.value)}
            />
          </label>
        </>
      )}
      <label>
        Address Line 1
        <input value={value.addressLine1 || ""} onChange={(e) => update("addressLine1", e.target.value)} />
      </label>
      <label>
        Address Line 2
        <input value={value.addressLine2 || ""} onChange={(e) => update("addressLine2", e.target.value)} />
      </label>
      <label>
        City / Town
        <input value={value.city || ""} onChange={(e) => update("city", e.target.value)} placeholder="e.g. Oraba" />
      </label>
      <label>
        State / Province / Region / District
        <input
          value={value.stateProvinceRegion || ""}
          onChange={(e) => update("stateProvinceRegion", e.target.value)}
          placeholder="e.g. Koboko District"
        />
      </label>
      <label>
        Postal Code (if any)
        <input value={value.postalCode || ""} onChange={(e) => update("postalCode", e.target.value)} />
      </label>
      <label>
        Country
        <input
          value={value.country || ""}
          onChange={(e) => update("country", e.target.value)}
          list={`${idPrefix}-country-list`}
          placeholder="Start typing a country..."
        />
        {/* A datalist, not a hard <select> -- it suggests the ~250 names this
            app otherwise recognizes (continent filters, map centroids), but
            still accepts free text for a name/spelling it doesn't know
            rather than blocking entry. */}
        <datalist id={`${idPrefix}-country-list`}>
          {COUNTRY_NAMES.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      {showMailFlags && (
        <div className="admin-checkbox-row" style={{ gridColumn: "1 / -1" }}>
          <label>
            <input
              type="checkbox"
              checked={!!value.receiveMail}
              onChange={(e) => update("receiveMail", e.target.checked)}
            />
            Receives mail here
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!value.receivePackages}
              onChange={(e) => update("receivePackages", e.target.checked)}
            />
            Receives packages here
          </label>
        </div>
      )}
    </div>
  );
}
