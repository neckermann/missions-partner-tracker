import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPartner } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getFipsCode } from "../utils/countryFipsCodes.js";
import { COUNTRY_CONTINENTS } from "../utils/countryContinents.js";

const COUNTRY_NAMES = Object.keys(COUNTRY_CONTINENTS).sort();

// Creating a partner asks for the few things you can't fill in later from
// the record itself: which kind it is, what to call it, and where it is.
// Everything else -- family, addresses, sending church, trips, support,
// links -- is edited in place on the partner's own page, section by
// section, rather than through one form holding the whole record at once.
// See components/admin/EditableSection.jsx.
export default function AdminPartnerForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { churchName } = useSettings();

  const [form, setForm] = useState({
    kind: searchParams.get("kind") === "organization" ? "organization" : "missionary",
    displayName: "",
    fieldDisplayName: "",
    country: "",
    overviewShort: "",
    orgType: "Local",
    isPublic: true,
    isRestricted: false,
    contactSafe: true,
    sentByOurChurch: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isOrg = form.kind === "organization";
  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const country = form.country.trim();
    try {
      const record = await createPartner({
        kind: form.kind,
        displayName: form.displayName.trim(),
        fieldDisplayName: form.fieldDisplayName.trim() || null,
        overviewShort: form.overviewShort.trim() || null,
        isPublic: form.isPublic,
        isRestricted: form.isRestricted,
        fipsCountryCode: getFipsCode(country) || null,
        addresses: country ? { physical: { country } } : undefined,
        ...(isOrg
          ? { orgType: form.orgType }
          : { contactSafe: form.contactSafe, sentByOurChurch: form.sentByOurChurch }),
      });
      navigate(`/admin/partners/${record.id}`);
    } catch (err) {
      setError(
        err.response?.data?.error?.[0]?.message || err.response?.data?.error || "Failed to create partner"
      );
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell">
      <h2>New Partner</h2>
      <p style={{ color: "#666", marginTop: "-0.5rem" }}>
        Just enough to create the record — you'll fill in the rest on the partner's page.
      </p>

      <form className="admin-form" onSubmit={handleSubmit}>
        <div className="admin-section">
          <div className="form-grid">
            <label>
              Partner Type
              <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                <option value="missionary">Missionary</option>
                <option value="organization">Organization</option>
              </select>
            </label>
            {isOrg && (
              <label>
                Organization Type
                <select value={form.orgType} onChange={(e) => set("orgType", e.target.value)}>
                  <option value="Local">Local</option>
                  <option value="National">National</option>
                </select>
              </label>
            )}
            <label>
              {isOrg ? "Organization Name" : "Display Name"}
              <input
                value={form.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                placeholder={isOrg ? "e.g. Hope Community Center" : "e.g. The Miller Family"}
                required
              />
            </label>
            <label>
              Country
              <input
                value={form.country}
                onChange={(e) => set("country", e.target.value)}
                list="new-partner-country-list"
                placeholder="Start typing a country..."
              />
              <datalist id="new-partner-country-list">
                {COUNTRY_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label>
              Field / Region Display Name
              <input
                value={form.fieldDisplayName}
                onChange={(e) => set("fieldDisplayName", e.target.value)}
                placeholder="e.g. West Africa"
              />
            </label>
          </div>

          <label style={{ marginTop: "0.75rem" }}>
            Short Overview
            <input
              value={form.overviewShort}
              onChange={(e) => set("overviewShort", e.target.value)}
              placeholder="One or two lines, shown on directory cards"
            />
          </label>

          <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
            {!isOrg && (
              <label>
                <input
                  type="checkbox"
                  checked={form.contactSafe}
                  onChange={(e) => set("contactSafe", e.target.checked)}
                />
                Safe to contact
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(e) => set("isPublic", e.target.checked)}
              />
              Show on public site
            </label>
            <label title="Masks the name to initials and coarsens the map pin to a country centroid on the public site.">
              <input
                type="checkbox"
                checked={form.isRestricted}
                onChange={(e) => set("isRestricted", e.target.checked)}
              />
              Restricted-access location
            </label>
            {!isOrg && (
              <label>
                <input
                  type="checkbox"
                  checked={form.sentByOurChurch}
                  onChange={(e) => set("sentByOurChurch", e.target.checked)}
                />
                Sent by {churchName || "our church"}
              </label>
            )}
          </div>

          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Creating..." : "Create Partner"}
            </button>
            <button type="button" className="btn secondary" onClick={() => navigate("/admin/partners")}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
