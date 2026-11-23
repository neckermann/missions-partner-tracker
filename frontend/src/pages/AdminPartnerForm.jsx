import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPartner } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getFipsCode } from "../utils/countryFipsCodes.js";
import { COUNTRY_CONTINENTS } from "../utils/countryContinents.js";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";
import Wizard from "../components/shared/Wizard.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";

const COUNTRY_NAMES = Object.keys(COUNTRY_CONTINENTS).sort();
// Same presets as the detail page's own Preferred Contact Method field
// (see AdminPartnerDetail.jsx) -- an editable combo, not a closed list,
// so nothing here forces that field to only ever offer these four.
const CONTACT_METHOD_PRESETS = ["Email", "Phone", "WhatsApp", "Signal"];

// Creating a partner asks for the few things you can't fill in later from
// the record itself: which kind it is, what to call it, and where it is.
// Everything else -- family, addresses, sending church, trips, support,
// links -- is edited in place on the partner's own page, section by
// section, rather than through one form holding the whole record at once.
// See components/admin/EditableSection.jsx.
//
// Phase 6 of the UX-rebuild plan: this is the one creation flow in the
// app with a genuine case for the Wizard shell -- ~10 real fields across
// three distinct conceptual groups (who/where, descriptive details,
// visibility/status), past the plan's own "wizard only worth it past
// ~5-6 fields" guidance. Every other "+Add X" flow surveyed for this
// phase (Prayer Requests, One-Time Needs, Support entries, Partner
// Files, Trips) has 3-6 fields and stays a short single-step form --
// see this phase's commit message for the full field-count survey and
// why those are deliberately NOT converted to wizards.
export default function AdminPartnerForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { churchName } = useSettings();

  const initialValues = {
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
    preferredContactMethod: "",
    supportingSince: "",
  };
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function handleFinish(values) {
    setSaving(true);
    setSubmitError("");
    const isOrg = values.kind === "organization";
    const country = values.country.trim();
    try {
      const record = await createPartner({
        kind: values.kind,
        displayName: values.displayName.trim(),
        fieldDisplayName: values.fieldDisplayName.trim() || null,
        overviewShort: values.overviewShort.trim() || null,
        isPublic: values.isPublic,
        isRestricted: values.isRestricted,
        preferredContactMethod: values.preferredContactMethod.trim() || null,
        supportingSince: values.supportingSince || null,
        fipsCountryCode: getFipsCode(country) || null,
        addresses: country ? { physical: { country } } : undefined,
        ...(isOrg
          ? { orgType: values.orgType }
          : { contactSafe: values.contactSafe, sentByOurChurch: values.sentByOurChurch }),
      });
      navigate(`/admin/partners/${record.id}`);
    } catch (err) {
      setSubmitError(
        err.response?.data?.error?.[0]?.message || err.response?.data?.error || "Failed to create partner"
      );
      setSaving(false);
    }
  }

  const steps = [
    {
      key: "basics",
      label: "Basics",
      validate: (values) => (values.displayName.trim() ? null : "Name is required."),
      render: ({ values, setValue }) => {
        const isOrg = values.kind === "organization";
        return (
          <div className="form-grid">
            <label>
              Partner Type
              <select value={values.kind} onChange={(e) => setValue("kind", e.target.value)}>
                <option value="missionary">Missionary</option>
                <option value="organization">Organization</option>
              </select>
            </label>
            {isOrg && (
              <label>
                Organization Type
                <select value={values.orgType} onChange={(e) => setValue("orgType", e.target.value)}>
                  <option value="Local">Local</option>
                  <option value="National">National</option>
                </select>
              </label>
            )}
            <label>
              {isOrg ? "Organization Name" : "Display Name"}
              <input
                value={values.displayName}
                onChange={(e) => setValue("displayName", e.target.value)}
                placeholder={isOrg ? "e.g. Hope Community Center" : "e.g. The Miller Family"}
                required
              />
            </label>
            <label>
              Country
              <input
                value={values.country}
                onChange={(e) => setValue("country", e.target.value)}
                list="new-partner-country-list"
                placeholder="Start typing a country..."
              />
              <datalist id="new-partner-country-list">
                {COUNTRY_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
          </div>
        );
      },
    },
    {
      key: "details",
      label: "Details",
      render: ({ values, setValue }) => (
        <>
          <div className="form-grid">
            <label title="Shown publicly even if this partner is restricted-access, since it doesn't reveal their exact location -- e.g. 'West Africa' rather than the specific country.">
              Field / Region Display Name
              <input
                value={values.fieldDisplayName}
                onChange={(e) => setValue("fieldDisplayName", e.target.value)}
                placeholder="e.g. West Africa"
              />
            </label>
            <label title="How this partner prefers to be reached. Shown on their page; doesn't affect anything else.">
              Preferred Contact Method
              <PresetOrCustomSelect
                value={values.preferredContactMethod}
                onChange={(v) => setValue("preferredContactMethod", v)}
                presets={CONTACT_METHOD_PRESETS}
                placeholder="e.g. Telegram"
              />
            </label>
            <label title="When this partner's support began. Leave it blank if you're not sure yet -- it's easy to set later.">
              Supporting Since
              <input
                type="date"
                value={values.supportingSince}
                onChange={(e) => setValue("supportingSince", e.target.value)}
              />
            </label>
          </div>
          <label style={{ marginTop: "0.75rem" }}>
            Short Overview
            <input
              value={values.overviewShort}
              onChange={(e) => setValue("overviewShort", e.target.value)}
              placeholder="One or two lines, shown on directory cards"
            />
          </label>
        </>
      ),
    },
    {
      key: "visibility",
      label: "Visibility & status",
      render: ({ values, setValue }) => {
        const isOrg = values.kind === "organization";
        return (
          <div className="admin-checkbox-row">
            {!isOrg && (
              <label title="A reminder for staff, not a public setting -- whether reaching out to this missionary directly is safe (e.g. in a sensitive location). Shown as a status pill on their page.">
                <input
                  type="checkbox"
                  checked={values.contactSafe}
                  onChange={(e) => setValue("contactSafe", e.target.checked)}
                />
                Safe to contact
              </label>
            )}
            <label title="Whether this partner appears in the public directory and map at all. Leave off for a partner you're not ready to list yet.">
              <input
                type="checkbox"
                checked={values.isPublic}
                onChange={(e) => setValue("isPublic", e.target.checked)}
              />
              Show on public site
            </label>
            <label title="Masks the name to initials and coarsens the map pin to a country centroid on the public site.">
              <input
                type="checkbox"
                checked={values.isRestricted}
                onChange={(e) => setValue("isRestricted", e.target.checked)}
              />
              Restricted-access location
            </label>
            {!isOrg && (
              <label title="Fills in the Sending Church section on this partner's page from this church's own info, overwriting anything typed there later. Set up Sending Church details afterward on their page.">
                <input
                  type="checkbox"
                  checked={values.sentByOurChurch}
                  onChange={(e) => setValue("sentByOurChurch", e.target.checked)}
                />
                Sent by {churchName || "our church"}
              </label>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="admin-shell">
      <Breadcrumb items={[{ label: "Partners", to: "/admin/partners" }, { label: "New Partner" }]} />
      <h2>New Partner</h2>
      <p style={{ color: "var(--muted)", marginTop: "-0.5rem" }}>
        Just enough to create the record — you'll fill in the rest on the partner's page.
      </p>

      <div className="admin-section">
        <Wizard
          steps={steps}
          initialValues={initialValues}
          onFinish={handleFinish}
          onCancel={() => navigate("/admin/partners")}
          finishing={saving}
        />
        {submitError && (
          <p style={{ color: "var(--danger)" }} role="alert">
            {submitError}
          </p>
        )}
      </div>
    </div>
  );
}
