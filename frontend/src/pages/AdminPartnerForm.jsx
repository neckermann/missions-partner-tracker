import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  fetchPartner,
  createPartner,
  updatePartner,
  uploadPartnerImage,
  fetchChurchSettings,
} from "../api/client.js";
import AddressFields from "../components/admin/AddressFields.jsx";
import SendingPartySection from "../components/admin/SendingPartySection.jsx";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";
import CountryStats from "../components/CountryStats.jsx";
import { getFipsCode } from "../utils/countryFipsCodes.js";

// The API now stores birthdays as a real DATE column, so it returns full
// ISO datetime strings (e.g. "1979-05-04T00:00:00.000Z"). <input type="date">
// needs exactly "YYYY-MM-DD", so trim it down for display.
function toDateInputValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

const CONTACT_METHOD_PRESETS = ["Email", "Phone", "WhatsApp", "Signal"];

const TRIP_TYPE_PRESETS = [
  "Construction",
  "Medical/Dental",
  "VBS/Children's Ministry",
  "Evangelism/Outreach",
  "Teaching/Discipleship",
  "Prayer",
  "General Labor",
  "Sports Ministry",
  "Music/Worship",
  "Administrative/Support",
];

const emptyAddress = {
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateProvinceRegion: "",
  postalCode: "",
  country: "",
};

// True if any field on the address has been filled in — used to avoid
// persisting an all-empty physical/mailing address. Only checks the known
// address fields, since a fetched record also carries id/missionaryId/type
// keys that shouldn't count as "content".
function hasAnyAddressValue(address) {
  return (
    Object.keys(emptyAddress).some((key) => Boolean(address[key] && address[key].trim())) ||
    Boolean(address.receiveMail) ||
    Boolean(address.receivePackages) ||
    address.gpsLat != null ||
    address.gpsLng != null
  );
}

const emptySendingParty = {
  name: "",
  contactName: "",
  contactEmail: "",
  websiteLink: "",
  phone: "",
  mailingAddress: { ...emptyAddress },
};

const emptyForm = {
  displayName: "",
  fieldDisplayName: "",
  fipsCountryCode: "",
  isPublic: false,
  isRestricted: false,
  contactSafe: true,
  preferredContactMethod: "",
  overview: "",
  overviewShort: "",
  focusArea: "",
  websiteLink: "",
  supportLink: "",
  newsletterSignup: "",
  facebook: "",
  twitter: "",
  instagram: "",
  linkedin: "",
  supportingSince: "",
  anniversary: "",
  languagesSpoken: [],
  tripTeamSizeMin: "",
  tripTeamSizeMax: "",
  tripTypesSupported: [],
  tripSeasonNotes: "",
  tripLogisticsNotes: "",
  furloughs: [],
  churchVisits: [],
  sentByOurChurch: false,
  // Organization-only. A missionary leaves these blank and the columns stay
  // null, the same way the database models it.
  orgType: "Local",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  addresses: {
    physical: { ...emptyAddress, gpsLat: null, gpsLng: null },
    mailing: { ...emptyAddress, receiveMail: false, receivePackages: false },
  },
  emergencyContact: { name: "", phone: "", email: "" },
  adults: [],
  children: [],
  sendingChurch: { ...emptySendingParty },
  sendingOrg: { ...emptySendingParty },
};

// Fetched records may have nulls for any nested JSON field (never edited)
// or a missing sendingChurch/sendingOrg relation entirely — fill in defaults
// so every field always has something to bind an input to.
function mergeFetchedRecord(m) {
  return {
    ...emptyForm,
    ...m,
    languagesSpoken: m.languagesSpoken || [],
    tripTypesSupported: m.tripTypesSupported || [],
    furloughs: m.furloughs || [],
    churchVisits: m.churchVisits || [],
    addresses: {
      physical: {
        ...emptyForm.addresses.physical,
        ...((m.addresses || []).find((a) => a.type === "physical") || {}),
      },
      mailing: {
        ...emptyForm.addresses.mailing,
        ...((m.addresses || []).find((a) => a.type === "mailing") || {}),
      },
    },
    emergencyContact: { ...emptyForm.emergencyContact, ...(m.emergencyContact || {}) },
    adults: m.adults || [],
    children: m.children || [],
    sendingChurch: {
      ...emptySendingParty,
      ...(m.sendingChurch || {}),
      mailingAddress: { ...emptyAddress, ...((m.sendingChurch || {}).mailingAddress || {}) },
    },
    sendingOrg: {
      ...emptySendingParty,
      ...(m.sendingOrg || {}),
      mailingAddress: { ...emptyAddress, ...((m.sendingOrg || {}).mailingAddress || {}) },
    },
  };
}

// One form for both kinds of partner. The kind is fixed at creation (from
// ?kind= on the new-partner route) and never changes afterwards — moving a
// record between kinds isn't a real workflow, and the sub-records differ
// enough that it wouldn't be a clean conversion anyway.
export default function AdminPartnerForm() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    kind: searchParams.get("kind") === "organization" ? "organization" : "missionary",
  }));
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageReceivedDate, setImageReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(null);
  const [customContactMethod, setCustomContactMethod] = useState(false);
  const [churchSettings, setChurchSettings] = useState(null);
  const isOrg = form.kind === "organization";

  useEffect(() => {
    fetchChurchSettings().then(setChurchSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (isEdit) {
      fetchPartner(id).then((m) => {
        const merged = mergeFetchedRecord(m);
        setForm(merged);
        setCurrentPhotoUrl(m.photos?.[0]?.url ?? null);
        if (merged.preferredContactMethod && !CONTACT_METHOD_PRESETS.includes(merged.preferredContactMethod)) {
          setCustomContactMethod(true);
        }
      });
    }
  }, [id]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function updateNested(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Auto-fills the FIPS field from the physical address's country the
  // moment it resolves to a known name, but only while the field is still
  // blank -- a manual entry (however it was made) is never overwritten,
  // since FIPS and ISO codes genuinely disagree for many countries and an
  // admin may deliberately want a specific one.
  function handlePhysicalAddressChange(addr) {
    setForm((f) => {
      const next = { ...f, addresses: { ...f.addresses, physical: addr } };
      if (!f.fipsCountryCode && addr.country !== f.addresses.physical?.country) {
        const fips = getFipsCode(addr.country);
        if (fips) next.fipsCountryCode = fips;
      }
      return next;
    });
  }

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  // Only clears a staged (not-yet-uploaded) file selection — the current
  // photo, once saved, is only ever deleted from the detail page's Photo
  // History section, since uploading here always adds a new photo rather
  // than replacing one (see PhotoHistorySection.jsx).
  function handleRemoveImage() {
    setImageFile(null);
    setImagePreview(null);
  }

  // --- Languages spoken (simple string list) ---
  function addLanguage() {
    update("languagesSpoken", [...form.languagesSpoken, ""]);
  }
  function updateLanguage(index, value) {
    const next = [...form.languagesSpoken];
    next[index] = value;
    update("languagesSpoken", next);
  }
  function removeLanguage(index) {
    update(
      "languagesSpoken",
      form.languagesSpoken.filter((_, i) => i !== index)
    );
  }

  // --- Adults ---
  function addAdult() {
    update("adults", [...form.adults, { name: "", phone1: "", phone2: "", email: "", birthday: "" }]);
  }
  function updateAdult(index, field, value) {
    const next = [...form.adults];
    next[index] = { ...next[index], [field]: value };
    update("adults", next);
  }
  function removeAdult(index) {
    update("adults", form.adults.filter((_, i) => i !== index));
  }

  // --- Children ---
  function addChild() {
    update("children", [...form.children, { name: "", birthday: "" }]);
  }
  function updateChild(index, field, value) {
    const next = [...form.children];
    next[index] = { ...next[index], [field]: value };
    update("children", next);
  }
  function removeChild(index) {
    update("children", form.children.filter((_, i) => i !== index));
  }

  // --- Trip types supported (simple string list) ---
  function addTripTypeSupported() {
    update("tripTypesSupported", [...form.tripTypesSupported, ""]);
  }
  function updateTripTypeSupported(index, value) {
    const next = [...form.tripTypesSupported];
    next[index] = value;
    update("tripTypesSupported", next);
  }
  function removeTripTypeSupported(index) {
    update(
      "tripTypesSupported",
      form.tripTypesSupported.filter((_, i) => i !== index)
    );
  }


  // --- Furlough history ---
  function addFurlough() {
    update("furloughs", [{ startDate: "", endDate: "", notes: "" }, ...form.furloughs]);
  }
  function updateFurlough(index, field, value) {
    const next = [...form.furloughs];
    next[index] = { ...next[index], [field]: value };
    update("furloughs", next);
  }
  function removeFurlough(index) {
    update("furloughs", form.furloughs.filter((_, i) => i !== index));
  }

  // --- Church visit history ---
  function addChurchVisit() {
    update("churchVisits", [{ visitDate: "", notes: "" }, ...form.churchVisits]);
  }
  function updateChurchVisit(index, field, value) {
    const next = [...form.churchVisits];
    next[index] = { ...next[index], [field]: value };
    update("churchVisits", next);
  }
  function removeChurchVisit(index) {
    update("churchVisits", form.churchVisits.filter((_, i) => i !== index));
  }

  // Checking "sent by our church" copies our own Church Settings data into
  // the Sending Church fields, one field at a time — only filling in
  // blanks, never overwriting anything already entered. Unchecking never
  // clears anything; this is a one-way convenience fill, not a sync.
  function handleSentByOurChurch(checked) {
    update("sentByOurChurch", checked);
    if (checked && churchSettings) {
      updateNested("sendingChurch", {
        ...form.sendingChurch,
        name: form.sendingChurch.name || churchSettings.churchName || "",
        contactName: form.sendingChurch.contactName || churchSettings.contactName || "",
        contactEmail: form.sendingChurch.contactEmail || churchSettings.contactEmail || "",
        phone: form.sendingChurch.phone || churchSettings.phone || "",
        websiteLink: form.sendingChurch.websiteLink || churchSettings.websiteLink || "",
        mailingAddress: hasAnyAddressValue(form.sendingChurch.mailingAddress || {})
          ? form.sendingChurch.mailingAddress
          : { ...emptyAddress, ...(churchSettings.address || {}) },
      });
    }
  }

  // Monthly support, one-time needs and trips are deliberately absent from
  // this form. Each is its own resource with its own endpoint, edited from
  // its section on the partner's page or from the consolidated admin page.
  // The partner PUT ignores them even if sent -- see the comment on
  // PUT /api/partners/:id in backend/src/routes/partners.js.

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);

    const cleanAdults = form.adults
      .map((a) => ({ ...a, name: a.name.trim(), birthday: a.birthday || null }))
      .filter((a) => a.name);
    const cleanChildren = form.children
      .map((c) => ({ ...c, name: c.name.trim(), birthday: c.birthday || null }))
      .filter((c) => c.name);
    const cleanLanguages = form.languagesSpoken.map((l) => l.trim()).filter(Boolean);
    const cleanTripTypesSupported = form.tripTypesSupported.map((t) => t.trim()).filter(Boolean);
    const cleanFurloughs = form.furloughs
      .filter((f) => f.startDate)
      .map((f) => ({ ...f, endDate: f.endDate || null }));
    const cleanChurchVisits = form.churchVisits.filter((v) => v.visitDate);
    // Drop rows missing their required fields rather than sending
    // half-filled entries — same convention as adults/children above.
    const cleanPhysical = {
      ...form.addresses.physical,
      gpsLat: form.addresses.physical.gpsLat === "" || form.addresses.physical.gpsLat == null
        ? null
        : Number(form.addresses.physical.gpsLat),
      gpsLng: form.addresses.physical.gpsLng === "" || form.addresses.physical.gpsLng == null
        ? null
        : Number(form.addresses.physical.gpsLng),
    };

    const payload = {
      ...form,
      supportingSince: form.supportingSince || null,
      anniversary: form.anniversary || null,
      languagesSpoken: cleanLanguages,
      tripTeamSizeMin: form.tripTeamSizeMin === "" ? null : Number(form.tripTeamSizeMin),
      tripTeamSizeMax: form.tripTeamSizeMax === "" ? null : Number(form.tripTeamSizeMax),
      tripTypesSupported: cleanTripTypesSupported,
      churchVisits: cleanChurchVisits,
      addresses: {
        physical: hasAnyAddressValue(cleanPhysical) ? cleanPhysical : undefined,
        mailing: hasAnyAddressValue(form.addresses.mailing) ? form.addresses.mailing : undefined,
      },
      // Missionary-only. Sent as undefined for an organization so the PUT
      // leaves those (always-empty) relations alone rather than clearing
      // and recreating them on every save.
      adults: isOrg ? undefined : cleanAdults,
      children: isOrg ? undefined : cleanChildren,
      furloughs: isOrg ? undefined : cleanFurloughs,
      // Only persist sending church/org if a name was actually entered —
      // otherwise leave whatever relation already exists untouched.
      sendingChurch: !isOrg && form.sendingChurch.name.trim() ? form.sendingChurch : undefined,
      sendingOrg: !isOrg && form.sendingOrg.name.trim() ? form.sendingOrg : undefined,
      emergencyContact: isOrg ? undefined : form.emergencyContact,
      // Organization-only, mirrored the same way.
      orgType: isOrg ? form.orgType : undefined,
      contactName: isOrg ? form.contactName : undefined,
      contactPhone: isOrg ? form.contactPhone : undefined,
      contactEmail: isOrg ? form.contactEmail : undefined,
    };

    try {
      const record = isEdit
        ? await updatePartner(id, payload)
        : await createPartner(payload);

      if (imageFile) {
        await uploadPartnerImage(record.id, imageFile, imageReceivedDate);
      }

      navigate(`/admin/partners/${record.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>
        {isEdit ? "Edit" : "Add"} {isOrg ? "Organization" : "Missionary"}
      </h2>
      <form onSubmit={handleSubmit} className="admin-form">
        <div className="admin-section">
          <h3>Photo</h3>
          <div className="headshot-row">
            {(imagePreview || currentPhotoUrl) && (
              <img
                src={imagePreview || currentPhotoUrl}
                alt="Headshot preview"
                className="missionary-thumb"
                style={{ width: 80, height: 80 }}
              />
            )}
            <label style={{ flex: 1 }}>
              Headshot Photo
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} />
            </label>
            {imageFile && (
              <label>
                Received Date
                <input
                  type="date"
                  value={imageReceivedDate}
                  onChange={(e) => setImageReceivedDate(e.target.value)}
                />
              </label>
            )}
            {imageFile && (
              <button type="button" className="btn secondary small" onClick={handleRemoveImage}>
                Cancel upload
              </button>
            )}
          </div>
          {isEdit && (
            <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.5rem" }}>
              Uploading here adds a new photo without deleting the current one —
              view the full history or delete an old photo from this
              missionary's detail page.
            </p>
          )}
        </div>

        <div className="admin-section">
          <h3>Core Info</h3>
          <div className="form-grid">
            <label>
              {isOrg ? "Organization Name" : "Display Name"}
              <input value={form.displayName} onChange={(e) => update("displayName", e.target.value)} required />
            </label>
            {isOrg && (
              <label>
                Organization Type
                <select value={form.orgType || "Local"} onChange={(e) => update("orgType", e.target.value)}>
                  <option value="Local">Local</option>
                  <option value="National">National</option>
                </select>
              </label>
            )}
            <label>
              Field / Region Display Name
              <input value={form.fieldDisplayName || ""} onChange={(e) => update("fieldDisplayName", e.target.value)} />
            </label>
            {isOrg && (
              <>
                <label>
                  Contact Name
                  <input value={form.contactName || ""} onChange={(e) => update("contactName", e.target.value)} />
                </label>
                <label>
                  Contact Phone
                  <input value={form.contactPhone || ""} onChange={(e) => update("contactPhone", e.target.value)} />
                </label>
                <label>
                  Contact Email
                  <input value={form.contactEmail || ""} onChange={(e) => update("contactEmail", e.target.value)} />
                </label>
              </>
            )}
            <label>
              Supporting Since
              <input
                type="date"
                value={toDateInputValue(form.supportingSince)}
                onChange={(e) => update("supportingSince", e.target.value)}
              />
            </label>
            <label>
              Preferred Contact Method
              {customContactMethod ? (
                <>
                  <input
                    value={form.preferredContactMethod || ""}
                    onChange={(e) => update("preferredContactMethod", e.target.value)}
                    placeholder="e.g. Telegram"
                  />
                  <button
                    type="button"
                    className="btn secondary small"
                    style={{ marginTop: "0.4rem", alignSelf: "flex-start" }}
                    onClick={() => {
                      setCustomContactMethod(false);
                      update("preferredContactMethod", "");
                    }}
                  >
                    Choose from list instead
                  </button>
                </>
              ) : (
                <select
                  value={form.preferredContactMethod || ""}
                  onChange={(e) => {
                    if (e.target.value === "__other__") {
                      setCustomContactMethod(true);
                      update("preferredContactMethod", "");
                    } else {
                      update("preferredContactMethod", e.target.value);
                    }
                  }}
                >
                  <option value="">Not specified</option>
                  <option value="Email">Email</option>
                  <option value="Phone">Phone</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Signal">Signal</option>
                  <option value="__other__">Other (specify)</option>
                </select>
              )}
            </label>
          </div>

          <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
            {!isOrg && (
              <label>
                <input type="checkbox" checked={form.contactSafe} onChange={(e) => update("contactSafe", e.target.checked)} />
                Safe to contact
              </label>
            )}
            <label>
              <input type="checkbox" checked={form.isPublic} onChange={(e) => update("isPublic", e.target.checked)} />
              Show on public site
            </label>
            <label>
              <input type="checkbox" checked={form.isRestricted} onChange={(e) => update("isRestricted", e.target.checked)} />
              Restricted-access location (mask public details)
            </label>
          </div>
        </div>



        <div className="admin-section">
          <h3>Ministry Overview</h3>
          <label>
            Short Overview
            <textarea
              rows={2}
              value={form.overviewShort || ""}
              onChange={(e) => update("overviewShort", e.target.value)}
              placeholder="One or two sentences — used for quick-read contexts like directory cards."
            />
          </label>
          <label style={{ marginTop: "1rem" }}>
            Full Overview
            <textarea rows={5} value={form.overview || ""} onChange={(e) => update("overview", e.target.value)} />
          </label>
          <label style={{ marginTop: "1rem" }}>
            Ministry Focus
            <textarea rows={3} value={form.focusArea || ""} onChange={(e) => update("focusArea", e.target.value)} />
          </label>
        </div>

        <div className="admin-section">
          <h3>Serving Location</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: "0.85rem" }}>
            Where they actually serve — a full street address if known and safe to record, or
            just city/state/country. The GPS coordinates drive the public map pin (coarsened to
            a country-level pin automatically for restricted-access missionaries). Leave the
            coordinates blank to have them looked up automatically from the address, or enter
            them manually for precise control. The rest of this address is admin-only and never
            shown on the public site.
          </p>
          <AddressFields
            value={form.addresses.physical}
            onChange={handlePhysicalAddressChange}
            showGps
            idPrefix="physical"
          />
          <label>
            Country Code (FIPS/ISO)
            <input value={form.fipsCountryCode || ""} onChange={(e) => update("fipsCountryCode", e.target.value)} />
          </label>
          <p style={{ marginTop: "0.4rem", color: "#666", fontSize: "0.85rem" }}>
            Used to look up Joshua Project country statistics below. Auto-filled from the
            physical address's country when recognized and this field is still blank — it uses
            FIPS codes specifically, which often differ from the more familiar ISO code (e.g. the
            Philippines is RP, not PH), so double-check it if you're entering it by hand.
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            <CountryStats countryCode={form.fipsCountryCode} />
          </div>
        </div>

        <div className="admin-section">
          <h3>Mailing &amp; Contact Address</h3>
          <AddressFields
            value={form.addresses.mailing}
            onChange={(addr) => updateNested("addresses", { ...form.addresses, mailing: addr })}
            showMailFlags
            idPrefix="mailing"
          />
        </div>

        {!isOrg && (
        <div className="admin-section">
          <h3>Adults</h3>
          <label style={{ maxWidth: "220px", marginBottom: "1rem" }}>
            Wedding Anniversary
            <input
              type="date"
              value={toDateInputValue(form.anniversary)}
              onChange={(e) => update("anniversary", e.target.value)}
            />
          </label>
          {form.adults.map((adult, i) => (
            <div className="repeatable-row" key={i}>
              <button type="button" className="btn-remove" onClick={() => removeAdult(i)} title="Remove">
                ✕
              </button>
              <div className="form-grid">
                <label>
                  Name
                  <input value={adult.name || ""} onChange={(e) => updateAdult(i, "name", e.target.value)} />
                </label>
                <label>
                  Birthday
                  <input
                    type="date"
                    value={toDateInputValue(adult.birthday)}
                    onChange={(e) => updateAdult(i, "birthday", e.target.value)}
                  />
                </label>
                <label>
                  Phone 1
                  <input value={adult.phone1 || ""} onChange={(e) => updateAdult(i, "phone1", e.target.value)} />
                </label>
                <label>
                  Phone 2
                  <input value={adult.phone2 || ""} onChange={(e) => updateAdult(i, "phone2", e.target.value)} />
                </label>
                <label>
                  Email
                  <input value={adult.email || ""} onChange={(e) => updateAdult(i, "email", e.target.value)} />
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addAdult}>
            + Add Adult
          </button>
        </div>
        )}

        {!isOrg && (
        <div className="admin-section">
          <h3>Children</h3>
          {form.children.map((child, i) => (
            <div className="repeatable-row" key={i}>
              <button type="button" className="btn-remove" onClick={() => removeChild(i)} title="Remove">
                ✕
              </button>
              <div className="form-grid">
                <label>
                  Name
                  <input value={child.name || ""} onChange={(e) => updateChild(i, "name", e.target.value)} />
                </label>
                <label>
                  Birthday
                  <input
                    type="date"
                    value={toDateInputValue(child.birthday)}
                    onChange={(e) => updateChild(i, "birthday", e.target.value)}
                  />
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addChild}>
            + Add Child
          </button>
        </div>
        )}

        {!isOrg && (
        <div className="admin-section">
          <h3>Emergency Contact</h3>
          <div className="form-grid">
            <label>
              Name
              <input
                value={form.emergencyContact.name || ""}
                onChange={(e) => updateNested("emergencyContact", { ...form.emergencyContact, name: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                value={form.emergencyContact.phone || ""}
                onChange={(e) => updateNested("emergencyContact", { ...form.emergencyContact, phone: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                value={form.emergencyContact.email || ""}
                onChange={(e) => updateNested("emergencyContact", { ...form.emergencyContact, email: e.target.value })}
              />
            </label>
          </div>
        </div>
        )}

        {!isOrg && (
        <div className="admin-section">
          <h3>Languages Spoken</h3>
          {form.languagesSpoken.map((lang, i) => (
            <div className="tag-input-row" key={i}>
              <input value={lang} onChange={(e) => updateLanguage(i, e.target.value)} placeholder="e.g. Spanish" />
              <button type="button" className="btn-remove" onClick={() => removeLanguage(i)} title="Remove">
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addLanguage}>
            + Add Language
          </button>
        </div>
        )}

        <div className="admin-section">
          <h3>Trip Capacity</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: "0.85rem" }}>
            What kind of short-term mission team this missionary is set up to host.
          </p>
          <div className="form-grid">
            <label>
              Team Size (Min)
              <input
                type="number"
                min="0"
                value={form.tripTeamSizeMin}
                onChange={(e) => update("tripTeamSizeMin", e.target.value)}
              />
            </label>
            <label>
              Team Size (Max)
              <input
                type="number"
                min="0"
                value={form.tripTeamSizeMax}
                onChange={(e) => update("tripTeamSizeMax", e.target.value)}
              />
            </label>
          </div>
          <h4>Trip Types Supported</h4>
          {form.tripTypesSupported.map((type, i) => (
            <div className="tag-input-row" key={i}>
              <PresetOrCustomSelect
                value={type}
                onChange={(val) => updateTripTypeSupported(i, val)}
                presets={TRIP_TYPE_PRESETS}
                placeholder="e.g. Photography"
              />
              <button type="button" className="btn-remove" onClick={() => removeTripTypeSupported(i)} title="Remove">
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addTripTypeSupported}>
            + Add Trip Type
          </button>
          <label style={{ marginTop: "1rem" }}>
            Best Time of Year / Duration Notes
            <textarea rows={2} value={form.tripSeasonNotes || ""} onChange={(e) => update("tripSeasonNotes", e.target.value)} />
          </label>
          <label style={{ marginTop: "1rem" }}>
            Lodging &amp; Logistics Notes
            <textarea
              rows={2}
              value={form.tripLogisticsNotes || ""}
              onChange={(e) => update("tripLogisticsNotes", e.target.value)}
            />
          </label>
        </div>


        {!isOrg && (
        <div className="admin-section">
          <h3>Furlough</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: "0.85rem" }}>
            Time off the field, back at home. Leave End Date blank for a furlough that's still
            ongoing or whose return date isn't set yet.
          </p>
          {form.furloughs.map((furlough, i) => (
            <div className="repeatable-row" key={i}>
              <button type="button" className="btn-remove" onClick={() => removeFurlough(i)} title="Remove">
                ✕
              </button>
              <div className="form-grid">
                <label>
                  Start Date
                  <input
                    type="date"
                    value={toDateInputValue(furlough.startDate)}
                    onChange={(e) => updateFurlough(i, "startDate", e.target.value)}
                  />
                </label>
                <label>
                  End Date
                  <input
                    type="date"
                    value={toDateInputValue(furlough.endDate)}
                    onChange={(e) => updateFurlough(i, "endDate", e.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <input value={furlough.notes || ""} onChange={(e) => updateFurlough(i, "notes", e.target.value)} />
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addFurlough}>
            + Add Furlough
          </button>
        </div>
        )}

        <div className="admin-section">
          <h3>Church Visits</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: "0.85rem" }}>
            Each time they came and visited the church — the most recent date is treated as the
            last visit.
          </p>
          {form.churchVisits.map((visit, i) => (
            <div className="repeatable-row" key={i}>
              <button type="button" className="btn-remove" onClick={() => removeChurchVisit(i)} title="Remove">
                ✕
              </button>
              <div className="form-grid">
                <label>
                  Visit Date
                  <input
                    type="date"
                    value={toDateInputValue(visit.visitDate)}
                    onChange={(e) => updateChurchVisit(i, "visitDate", e.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <input value={visit.notes || ""} onChange={(e) => updateChurchVisit(i, "notes", e.target.value)} />
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addChurchVisit}>
            + Add Visit
          </button>
        </div>

        {/* Missionary-only: an organization has no "who sent it" concept. */}
        {!isOrg && (
          <>
            <SendingPartySection
              title="Sending Church"
              value={form.sendingChurch}
              onChange={(val) => updateNested("sendingChurch", val)}
              checkbox={{
                checked: form.sentByOurChurch,
                onChange: handleSentByOurChurch,
                label: `Sent by ${churchSettings?.churchName || "our church"}`,
              }}
            />

            <SendingPartySection
              title="Sending Org"
              value={form.sendingOrg}
              onChange={(val) => updateNested("sendingOrg", val)}
            />
          </>
        )}

        <div className="admin-section">
          <h3>Links &amp; Social Media</h3>
          <div className="form-grid">
            <label>
              Website
              <input value={form.websiteLink || ""} onChange={(e) => update("websiteLink", e.target.value)} />
            </label>
            <label>
              Support Link
              <input value={form.supportLink || ""} onChange={(e) => update("supportLink", e.target.value)} />
            </label>
            <label>
              Newsletter Signup
              <input
                value={form.newsletterSignup || ""}
                onChange={(e) => update("newsletterSignup", e.target.value)}
              />
            </label>
          </div>
          <h4>Social Media</h4>
          <div className="form-grid">
            {["facebook", "twitter", "instagram", "linkedin"].map((platform) => (
              <label key={platform} style={{ textTransform: "capitalize" }}>
                {platform}
                <input value={form[platform] || ""} onChange={(e) => update(platform, e.target.value)} />
              </label>
            ))}
          </div>
        </div>

        <div className="form-save-bar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => navigate(isEdit ? `/admin/partners/${id}` : "/admin/partners")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
