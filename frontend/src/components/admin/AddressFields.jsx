import React, { useState } from "react";
import SuggestInput from "../SuggestInput.jsx";
import { COUNTRY_CONTINENTS } from "../../utils/countryContinents.js";
import { streetHint } from "../../utils/webAddress.js";

const COUNTRY_NAMES = Object.keys(COUNTRY_CONTINENTS).sort();

// Geocoding often returns 15+ decimals; 5 (~1m) is plenty for a map pin. Exported so view-mode
// summaries round the same way.
export function roundGps(n) {
  if (n === null || n === undefined || n === "") return "";
  return Math.round(Number(n) * 1e5) / 1e5;
}

// `mailing` marks a mailing address (letters and parcels go there), whose first line must be a street address or a
// PO box: when you leave the box a short note appears if it is neither. Never for a serving location, which is
// often a village with no street. Only a hint; it never blocks saving.
export default function AddressFields({
  value,
  onChange,
  showMailFlags = false,
  showGps = false,
  mailing = false,
}) {
  const [lineTouched, setLineTouched] = useState(false);
  const line1Hint = mailing && lineTouched ? streetHint(value.addressLine1) : "";
  function update(field, val) {
    onChange({ ...value, [field]: val });
  }

  return (
    <div className="form-grid">
      <label>
        Address Line 1
        <input
          value={value.addressLine1 || ""}
          onChange={(e) => update("addressLine1", e.target.value)}
          onBlur={() => setLineTouched(true)}
          aria-invalid={line1Hint ? "true" : undefined}
        />
        {line1Hint && (
          <span role="status" style={{ display: "block", color: "var(--danger)", fontSize: "0.85rem" }}>
            {line1Hint}
          </span>
        )}
      </label>
      <label>
        Address Line 2
        <input value={value.addressLine2 || ""} onChange={(e) => update("addressLine2", e.target.value)} />
      </label>
      <label>
        City / Town
        <input
          value={value.city || ""}
          onChange={(e) => update("city", e.target.value)}
          placeholder="e.g. Oraba"
        />
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
        {/* A suggestion list, not a hard <select> -- it suggests the ~250 names this app otherwise
            recognizes (continent filters, map centroids), but still accepts free text for a
            name/spelling it doesn't know. Not a <datalist>: those don't work on many phones. */}
        <SuggestInput
          value={value.country || ""}
          onChange={(v) => update("country", v)}
          options={COUNTRY_NAMES}
          placeholder="Start typing a country..."
        />
      </label>
      {showGps && (
        <>
          <label title="Places this partner's pin on the public map. Leave both blank and saving will auto-fill them from the city/state/country above (via OpenStreetMap) -- that lands on the city, not an exact address. Enter coordinates here yourself for more precise placement.">
            GPS Latitude
            <input
              type="number"
              step="any"
              value={roundGps(value.gpsLat)}
              onChange={(e) => update("gpsLat", e.target.value === "" ? null : e.target.value)}
            />
          </label>
          <label title="Places this partner's pin on the public map. Leave both blank and saving will auto-fill them from the city/state/country above (via OpenStreetMap) -- that lands on the city, not an exact address. Enter coordinates here yourself for more precise placement.">
            GPS Longitude
            <input
              type="number"
              step="any"
              value={roundGps(value.gpsLng)}
              onChange={(e) => update("gpsLng", e.target.value === "" ? null : e.target.value)}
            />
          </label>
        </>
      )}
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
