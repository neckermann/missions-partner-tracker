import SuggestInput from "../components/SuggestInput.jsx";
import { CONTACT_LEVELS } from "../utils/contactMethods.js";
import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createPartner } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import { getFipsCode } from "../utils/countryFipsCodes.js";
import { COUNTRY_CONTINENTS } from "../utils/countryContinents.js";
import Wizard from "../components/shared/Wizard.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";

const COUNTRY_NAMES = Object.keys(COUNTRY_CONTINENTS).sort();
// Same presets as the detail page's Preferred Contact Method field (AdminPartnerDetail.jsx);
// an editable combo, not a closed list.

// Creating a partner asks only for what can't be filled in later: kind, name and location.
// Everything else is edited in place on the partner's own page (components/admin/EditableSection.jsx).
// This is the one creation flow that is a Wizard (~10 fields in three groups); the other
// "+Add X" flows have 3-6 fields and stay single-step.
export default function AdminPartnerForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { churchName } = useSettings();
  const { isAdmin } = useCurrentUser();

  const initialValues = {
    kind: searchParams.get("kind") === "organization" ? "organization" : "missionary",
    displayName: "",
    fieldDisplayName: "",
    country: "",
    overviewShort: "",
    orgType: "Local",
    isPublic: false,
    isRestricted: false,
    contactLevel: "normal",
    sentByOurChurch: false,
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
        supportingSince: values.supportingSince || null,
        fipsCountryCode: getFipsCode(country) || null,
        addresses: country ? { physical: { country } } : undefined,
        ...(isOrg
          ? { orgType: values.orgType }
          : { contactLevel: values.contactLevel, sentByOurChurch: values.sentByOurChurch }),
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
              <SuggestInput
                value={values.country}
                onChange={(v) => setValue("country", v)}
                options={COUNTRY_NAMES}
                placeholder="Start typing a country..."
              />
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
            <label title="When this partner's support began. Leave it blank if you're not sure yet -- it's easy to set later.">
              Partnering Since
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
              <label title="How careful to be when reaching this missionary. 'Use caution' keeps their details but shows your guidelines; 'Don't contact directly' hides their number and email. You can add the guidelines and who to go through on their Contact card.">
                Contacting them
                <select
                  value={values.contactLevel}
                  onChange={(e) => setValue("contactLevel", e.target.value)}
                >
                  {CONTACT_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={values.isPublic}
                onChange={(e) => setValue("isPublic", e.target.checked)}
              />
              Show on public site
            </label>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              Ticked: anyone on the internet can see this partner's name, photo, place on the map and short
              overview. Not ticked: only signed-in people can see them. You can change this at any time on the
              partner's page.
            </p>
            <label>
              <input
                type="checkbox"
                checked={values.isRestricted}
                onChange={(e) => setValue("isRestricted", e.target.checked)}
              />
              Restricted-access location
            </label>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
              For partners where being named publicly could be unsafe. On the public site the name is replaced
              by initials and the map pin is moved to the middle of the country.
              {isAdmin && (
                <>
                  {" "}
                  <Link to="/admin/settings/privacy">Change what restricted partners show</Link>.
                </>
              )}
            </p>
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
