import React, { useEffect, useState } from "react";
import { PHONE_COUNTRIES, phoneCountryLabel } from "../utils/phoneCountries.js";
import EmailInput from "../components/shared/EmailInput.jsx";
import PhoneField from "../components/shared/PhoneField.jsx";
import { formatPhone } from "../utils/phone.js";
import { updateChurchSettings, syncAllSendingChurch, uploadChurchLogo } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import AddressFields from "../components/admin/AddressFields.jsx";
import WebAddressInput from "../components/shared/WebAddressInput.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
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
  currency: "USD",
  defaultPhoneCountry: "US",
  ...emptyAddress,
  partnerTermSingular: "",
  partnerTermPlural: "",
  usePartnerTermInAdmin: false,
  publicTagline: "",
  aboutText: "",
  subscribePassage: "",
  subscribePassageSource: "",
  primaryColor: "",
  headerColor: "",
  highlightColor: "",
  brandFont: "",
  logo: {},
};

const TIMEZONES = Intl.supportedValuesOf("timeZone");

// Every currency this browser knows, labelled "USD - US Dollar" so a church can find its own.
const CURRENCIES = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  return Intl.supportedValuesOf("currency").map((code) => ({
    code,
    label: `${code} - ${names.of(code) || code}`,
  }));
})();

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
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState("");
  const [showSyncPrompt, setShowSyncPrompt] = useState(false);

  const { settings, error: settingsError } = useChurchSettings();
  useEffect(() => {
    if (settings) {
      setForm(mergeFetchedRecord(settings));
      setSentByOurChurchCount(settings?.sentByOurChurchCount || 0);
    }
  }, [settings]);

  async function reload() {
    const updated = await updateChurchSettings({});
    setForm(mergeFetchedRecord(updated));
    setSentByOurChurchCount(updated?.sentByOurChurchCount || 0);
    refreshSettings();
  }

  async function saveChurchInfo(draft) {
    const updated = await updateChurchSettings(draft);
    setShowSyncPrompt((updated?.sentByOurChurchCount || 0) > 0);
    // Every amount in the app follows the currency, so the shared settings are fetched again.
    refreshSettings();
  }

  async function handleSyncAll() {
    setSyncing(true);
    setSyncSuccess("");
    try {
      const { updatedCount } = await syncAllSendingChurch();
      setSyncSuccess(`Updated ${updatedCount} partner${updatedCount === 1 ? "" : "s"}.`);
    } catch {
      setSyncSuccess("Couldn't update partners with this info.");
    } finally {
      setSyncing(false);
    }
  }

  if (settingsError) {
    return (
      <div className="admin-shell">
        <SettingsPageHeader title="About & Branding" />
        <p className="form-error" role="alert">
          Couldn't load church settings.
        </p>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <SettingsPageHeader title="About & Branding" />
      <p style={{ color: "var(--muted)" }}>
        Church info, contact details, and how this church presents itself — public-site tagline, about text,
        brand colors, font, logo, and what to call its partners.
      </p>

      <EditableSection
        title="Church Info"
        value={{
          churchName: form.churchName,
          phone: formatPhone(form.phone),
          contactFirstName: form.contactFirstName,
          contactLastName: form.contactLastName,
          contactEmail: form.contactEmail,
          websiteLink: form.websiteLink,
          timezone: form.timezone,
          currency: form.currency,
          defaultPhoneCountry: form.defaultPhoneCountry,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2,
          city: form.city,
          stateProvinceRegion: form.stateProvinceRegion,
          postalCode: form.postalCode,
          country: form.country,
        }}
        onSave={saveChurchInfo}
        onSaved={reload}
        view={(v) => (
          <>
            <p>
              <strong>{v.churchName || "Not set"}</strong>
            </p>
            <p style={{ color: "var(--muted)" }}>
              {[v.contactFirstName, v.contactLastName].filter(Boolean).join(" ") || "No contact set"}
              {v.contactEmail ? ` · ${v.contactEmail}` : ""}
              {v.phone ? ` · ${formatPhone(v.phone)}` : ""}
            </p>
            <p style={{ color: "var(--muted)" }}>{v.websiteLink || "No website set"}</p>
            <p style={{ color: "var(--muted)" }}>Timezone: {v.timezone}</p>
            <p style={{ color: "var(--muted)" }}>Currency: {v.currency || "USD"}</p>
            <p style={{ color: "var(--muted)" }}>
              Phone numbers typed without a + are read as: {phoneCountryLabel(v.defaultPhoneCountry || "US")}
            </p>
            {showSyncPrompt && sentByOurChurchCount > 0 && (
              // Not interactive: stops clicks/keydowns on the inner button bubbling to the card's open handler.
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <div
                className="table-actions"
                style={{ marginTop: "0.75rem", alignItems: "center" }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <span style={{ color: "var(--muted)" }}>
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
                {syncSuccess && (
                  <span style={{ color: "var(--brand-color-safe, #2a5d3c)" }}>{syncSuccess}</span>
                )}
              </div>
            )}
          </>
        )}
        edit={(d, set) => (
          <>
            <div className="form-grid">
              <label>
                Church Name
                <input value={d.churchName || ""} onChange={(e) => set("churchName", e.target.value)} />
              </label>
              <PhoneField
                label="Phone"
                inputMode="tel"
                value={d.phone || ""}
                onChange={(e) => set("phone", e.target.value)}
                autoComplete="off"
              />
              <label>
                Contact First Name
                <input
                  value={d.contactFirstName || ""}
                  onChange={(e) => set("contactFirstName", e.target.value)}
                />
              </label>
              <label>
                Contact Last Name
                <input
                  value={d.contactLastName || ""}
                  onChange={(e) => set("contactLastName", e.target.value)}
                />
              </label>
              <label>
                Contact Email
                <EmailInput
                  value={d.contactEmail || ""}
                  onChange={(e) => set("contactEmail", e.target.value)}
                />
              </label>
              <label>
                Website
                <WebAddressInput
                  value={d.websiteLink || ""}
                  onChange={(e) => set("websiteLink", e.target.value)}
                />
              </label>
              <label>
                Timezone
                <select value={d.timezone || "UTC"} onChange={(e) => set("timezone", e.target.value)}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Currency
                <select value={d.currency || "USD"} onChange={(e) => set("currency", e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Phone numbers without a + are read as
                <select
                  value={d.defaultPhoneCountry || "US"}
                  onChange={(e) => set("defaultPhoneCountry", e.target.value)}
                >
                  {PHONE_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Phone numbers are saved with their country code (+1 506 555 0259). When someone types a number
              without a + the app assumes it is in this country, so a church in the United Kingdom can type
              020 7946 0958. A number that starts with + always keeps its own country. It never changes a
              number already saved.
            </p>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Currency is how every amount in the app is written (monthly support, one-time needs, trip money,
              reports and announcements). It only changes the symbol: amounts already saved are not converted,
              so a church that changes it should check its existing figures.
            </p>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
              Timezone drives every scheduled send in this app (email digests, GroupMe) so "send at 9"
              actually means 9am here, not UTC. Changing this takes effect the next time the app restarts, not
              instantly.
            </p>
            <h4>Address</h4>
            <AddressFields
              value={{
                addressLine1: d.addressLine1,
                addressLine2: d.addressLine2,
                city: d.city,
                stateProvinceRegion: d.stateProvinceRegion,
                postalCode: d.postalCode,
                country: d.country,
              }}
              onChange={(addr) => {
                Object.entries(addr).forEach(([key, val]) => set(key, val));
              }}
              mailing
            />
          </>
        )}
      />

      <div style={{ marginTop: "1rem" }}>
        <EditableSection
          title="Public Site & Branding"
          value={{
            publicTagline: form.publicTagline,
            aboutText: form.aboutText,
            subscribePassage: form.subscribePassage,
            subscribePassageSource: form.subscribePassageSource,
            headerColor: form.headerColor,
            primaryColor: form.primaryColor,
            highlightColor: form.highlightColor,
            brandFont: form.brandFont,
          }}
          onSave={updateChurchSettings}
          onSaved={reload}
          view={(v) => (
            <>
              <p>
                <strong>Tagline:</strong> {v.publicTagline || "Not set"}
              </p>
              <p style={{ color: "var(--muted)" }}>{v.aboutText || "No about text set"}</p>
              <p style={{ color: "var(--muted)" }}>
                <strong>Subscribe page passage:</strong>{" "}
                {v.subscribePassage
                  ? `${v.subscribePassage.slice(0, 80)}${v.subscribePassage.length > 80 ? "…" : ""}${v.subscribePassageSource ? ` (${v.subscribePassageSource})` : ""}`
                  : "None. The page shows no passage."}
              </p>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                <span
                  title="Header color"
                  style={{
                    display: "inline-block",
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: v.headerColor || "#2c2a28",
                    border: "1px solid var(--border)",
                  }}
                />
                <span
                  title="Accent color"
                  style={{
                    display: "inline-block",
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: v.primaryColor || "#2a5d3c",
                    border: "1px solid var(--border)",
                  }}
                />
                <span
                  title="Highlight color"
                  style={{
                    display: "inline-block",
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: v.highlightColor || "#a6540f",
                    border: "1px solid var(--border)",
                  }}
                />
              </div>
            </>
          )}
          edit={(d, set) => (
            <>
              <label>
                Tagline
                <input
                  value={d.publicTagline || ""}
                  onChange={(e) => set("publicTagline", e.target.value)}
                  placeholder="e.g. Prayer & Support Directory"
                />
              </label>
              <label style={{ marginTop: "1rem" }}>
                About
                <textarea
                  rows={4}
                  value={d.aboutText || ""}
                  onChange={(e) => set("aboutText", e.target.value)}
                  placeholder="An optional blurb shown on the public partner directory."
                />
              </label>
              <label style={{ marginTop: "1rem" }}>
                Scripture passage on the Subscribe page
                <textarea
                  rows={4}
                  value={d.subscribePassage || ""}
                  onChange={(e) => set("subscribePassage", e.target.value)}
                  placeholder="Optional. Leave empty to show no passage."
                />
              </label>
              <label style={{ marginTop: "0.5rem" }}>
                Where the passage is from
                <input
                  value={d.subscribePassageSource || ""}
                  onChange={(e) => set("subscribePassageSource", e.target.value)}
                  placeholder="e.g. Ephesians 6:18 (ESV)"
                />
              </label>
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                Shown above the form where people sign up for prayer updates. You choose the translation, and
                check that its licence lets you quote it.
              </p>
              <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
                Header Color
                <input
                  type="color"
                  value={d.headerColor || "#2c2a28"}
                  onChange={(e) => set("headerColor", e.target.value)}
                />
              </label>
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                The header bar and admin sidebar background.
              </p>
              <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
                Accent Color
                <input
                  type="color"
                  value={d.primaryColor || "#2a5d3c"}
                  onChange={(e) => set("primaryColor", e.target.value)}
                />
              </label>
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                Buttons, links, headings, and report letterheads -- the color people associate with this
                church.
              </p>
              <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
                Highlight Color
                <input
                  type="color"
                  value={d.highlightColor || "#a6540f"}
                  onChange={(e) => set("highlightColor", e.target.value)}
                />
              </label>
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                Hover, focus, and active/selected states -- e.g. a button on hover, the current nav item.
              </p>
              <label style={{ marginTop: "1rem", maxWidth: "220px" }}>
                Font
                <select value={d.brandFont || ""} onChange={(e) => set("brandFont", e.target.value || null)}>
                  {FONT_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() => {
                    set("headerColor", "");
                    set("primaryColor", "");
                    set("highlightColor", "");
                    set("brandFont", "");
                  }}
                >
                  Reset to Default
                </button>
              </div>
            </>
          )}
        />
      </div>

      <div style={{ marginTop: "1rem" }}>
        <EditableSection
          title="Logo"
          value={{ logo: form.logo, imageFile: null, imagePreview: null }}
          onSave={async (draft) => {
            if (draft.imageFile) {
              await uploadChurchLogo(draft.imageFile);
            } else if (draft.logo === null) {
              await updateChurchSettings({ logo: null });
            }
          }}
          onSaved={reload}
          view={(v) => (
            <div className="headshot-row">
              {v.logo?.url ? (
                <img
                  src={v.logo.url}
                  alt="Logo preview"
                  className="logo-preview"
                  style={{ background: form.headerColor || "#2c2a28" }}
                />
              ) : (
                <p style={{ color: "var(--muted)" }}>No logo set</p>
              )}
            </div>
          )}
          edit={(d, set) => {
            function handleImageSelect(e) {
              const file = e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => set("imagePreview", reader.result);
              reader.readAsDataURL(file);
              set("imageFile", file);
              set("logo", { ...(d.logo || {}) });
            }
            function handleRemoveImage() {
              set("imageFile", null);
              set("imagePreview", null);
              set("logo", null);
            }
            return (
              <div className="headshot-row">
                {(d.imagePreview || d.logo?.url) && (
                  <img
                    src={d.imagePreview || d.logo.url}
                    alt="Logo preview"
                    className="logo-preview"
                    style={{ background: form.headerColor || "#2c2a28" }}
                  />
                )}
                <label style={{ flex: 1 }}>
                  Logo Image
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} />
                </label>
                {(d.imagePreview || d.logo?.url) && (
                  <button type="button" className="btn secondary small" onClick={handleRemoveImage}>
                    Remove logo
                  </button>
                )}
              </div>
            );
          }}
        />
      </div>

      <div style={{ marginTop: "1rem" }}>
        <EditableSection
          title="Partner Terminology"
          value={{
            partnerTermSingular: form.partnerTermSingular,
            partnerTermPlural: form.partnerTermPlural,
            usePartnerTermInAdmin: form.usePartnerTermInAdmin,
          }}
          onSave={updateChurchSettings}
          onSaved={reload}
          view={(v) => (
            <p>
              {v.partnerTermSingular || "Missionary"} / {v.partnerTermPlural || "Missionaries"}
              {v.usePartnerTermInAdmin ? " (also used in the admin interface)" : ""}
            </p>
          )}
          edit={(d, set) => (
            <>
              <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
                What this church calls its missionary and organization partners — e.g. "Go Team Partner" / "Go
                Team Partners". Used on the public site regardless of whether a partner is an
                individual/family or an organization. Leave blank to keep the default "Missionary" /
                "Missionaries" wording.
              </p>
              <div className="form-grid">
                <label>
                  Singular
                  <input
                    value={d.partnerTermSingular || ""}
                    onChange={(e) => set("partnerTermSingular", e.target.value)}
                    placeholder="Missionary"
                  />
                </label>
                <label>
                  Plural
                  <input
                    value={d.partnerTermPlural || ""}
                    onChange={(e) => set("partnerTermPlural", e.target.value)}
                    placeholder="Missionaries"
                  />
                </label>
              </div>
              <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
                <label>
                  <input
                    type="checkbox"
                    checked={d.usePartnerTermInAdmin}
                    onChange={(e) => set("usePartnerTermInAdmin", e.target.checked)}
                  />
                  Also use this term in the admin interface (nav/list headings)
                </label>
              </div>
            </>
          )}
        />
      </div>
    </div>
  );
}
