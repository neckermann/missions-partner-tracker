import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchAdminOrganization,
  createOrganization,
  updateOrganization,
  uploadOrganizationImage,
} from "../api/client.js";
import AddressFields from "../components/admin/AddressFields.jsx";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";
import CountryStats from "../components/CountryStats.jsx";

// The API stores dates as real DATE columns, so it returns full ISO
// datetime strings (e.g. "2024-01-01T00:00:00.000Z"). <input type="date">
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

const emptyTrip = {
  startDate: "",
  endDate: "",
  tripType: "",
  description: "",
  notes: "",
  participants: [],
};

const emptyAddress = {
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateProvinceRegion: "",
  postalCode: "",
  country: "",
};

// True if any field on the address has been filled in — used to avoid
// persisting an all-empty physical/mailing address.
function hasAnyAddressValue(address) {
  return (
    Object.keys(emptyAddress).some((key) => Boolean(address[key] && address[key].trim())) ||
    Boolean(address.receiveMail) ||
    Boolean(address.receivePackages) ||
    address.gpsLat != null ||
    address.gpsLng != null
  );
}

const emptyForm = {
  name: "",
  orgType: "Local",
  fieldDisplayName: "",
  fipsCountryCode: "",
  isPublic: false,
  isRestricted: false,
  overview: "",
  overviewShort: "",
  focusArea: "",
  supportingSince: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  preferredContactMethod: "",
  websiteLink: "",
  supportLink: "",
  newsletterSignup: "",
  facebook: "",
  twitter: "",
  instagram: "",
  linkedin: "",
  tripTeamSizeMin: "",
  tripTeamSizeMax: "",
  tripTypesSupported: [],
  tripSeasonNotes: "",
  tripLogisticsNotes: "",
  orgTrips: [],
  churchVisits: [],
  supportEntries: [],
  needRequests: [],
  addresses: {
    physical: { ...emptyAddress, gpsLat: null, gpsLng: null },
    mailing: { ...emptyAddress, receiveMail: false, receivePackages: false },
  },
};

// Fetched records may have nulls for any nested JSON field or a missing
// address entirely — fill in defaults so every field always has something
// to bind an input to.
function mergeFetchedRecord(o) {
  return {
    ...emptyForm,
    ...o,
    tripTypesSupported: o.tripTypesSupported || [],
    orgTrips: (o.orgTrips || []).map((t) => ({ ...t, participants: t.participants || [] })),
    churchVisits: o.churchVisits || [],
    supportEntries: o.supportEntries || [],
    needRequests: o.needRequests || [],
    addresses: {
      physical: {
        ...emptyForm.addresses.physical,
        ...((o.addresses || []).find((a) => a.type === "physical") || {}),
      },
      mailing: {
        ...emptyForm.addresses.mailing,
        ...((o.addresses || []).find((a) => a.type === "mailing") || {}),
      },
    },
  };
}

export default function AdminOrganizationForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageReceivedDate, setImageReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(null);
  const [customContactMethod, setCustomContactMethod] = useState(false);

  useEffect(() => {
    if (isEdit) {
      fetchAdminOrganization(id).then((o) => {
        const merged = mergeFetchedRecord(o);
        setForm(merged);
        setCurrentPhotoUrl(o.photos?.[0]?.url ?? null);
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

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  // Only clears a staged (not-yet-uploaded) file selection — see the
  // equivalent comment in AdminMissionaryForm.jsx.
  function handleRemoveImage() {
    setImageFile(null);
    setImagePreview(null);
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

  // --- Trip history ---
  function addTrip() {
    update("orgTrips", [...form.orgTrips, { ...emptyTrip }]);
  }
  function updateTrip(index, field, value) {
    const next = [...form.orgTrips];
    next[index] = { ...next[index], [field]: value };
    update("orgTrips", next);
  }
  function removeTrip(index) {
    update("orgTrips", form.orgTrips.filter((_, i) => i !== index));
  }
  function addParticipant(tripIndex) {
    const next = [...form.orgTrips];
    next[tripIndex] = {
      ...next[tripIndex],
      participants: [...(next[tripIndex].participants || []), { name: "", role: "", isLeader: false, phone: "", email: "" }],
    };
    update("orgTrips", next);
  }
  function updateParticipant(tripIndex, participantIndex, field, value) {
    const next = [...form.orgTrips];
    const participants = [...(next[tripIndex].participants || [])];
    participants[participantIndex] = { ...participants[participantIndex], [field]: value };
    next[tripIndex] = { ...next[tripIndex], participants };
    update("orgTrips", next);
  }
  function removeParticipant(tripIndex, participantIndex) {
    const next = [...form.orgTrips];
    next[tripIndex] = {
      ...next[tripIndex],
      participants: next[tripIndex].participants.filter((_, i) => i !== participantIndex),
    };
    update("orgTrips", next);
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

  // --- Monthly support history ---
  function addSupportEntry() {
    update("supportEntries", [{ amount: "", effectiveDate: "", notes: "" }, ...form.supportEntries]);
  }
  function updateSupportEntry(index, field, value) {
    const next = [...form.supportEntries];
    next[index] = { ...next[index], [field]: value };
    update("supportEntries", next);
  }
  function removeSupportEntry(index) {
    update("supportEntries", form.supportEntries.filter((_, i) => i !== index));
  }

  // --- One-time need requests ---
  function addSupportNeed() {
    update("needRequests", [
      { description: "", requestedAmount: "", requestDate: "", approvedAmount: "", approvedDate: "", notes: "" },
      ...form.needRequests,
    ]);
  }
  function updateSupportNeed(index, field, value) {
    const next = [...form.needRequests];
    next[index] = { ...next[index], [field]: value };
    update("needRequests", next);
  }
  function removeSupportNeed(index) {
    update("needRequests", form.needRequests.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);

    const cleanTripTypesSupported = form.tripTypesSupported.map((t) => t.trim()).filter(Boolean);
    const cleanChurchVisits = form.churchVisits.filter((v) => v.visitDate);
    const cleanSupportEntries = form.supportEntries
      .filter((s) => s.effectiveDate && s.amount !== "")
      .map((s) => ({ ...s, amount: Number(s.amount) }));
    const cleanSupportNeeds = form.needRequests
      .filter((s) => s.description.trim() && s.requestDate && s.requestedAmount !== "")
      .map((s) => ({
        ...s,
        description: s.description.trim(),
        requestedAmount: Number(s.requestedAmount),
        approvedAmount: s.approvedAmount === "" || s.approvedAmount == null ? null : Number(s.approvedAmount),
        approvedDate: s.approvedDate || null,
      }));
    const cleanOrgTrips = form.orgTrips.map((trip) => ({
      ...trip,
      startDate: trip.startDate || null,
      endDate: trip.endDate || null,
      participants: (trip.participants || [])
        .map((p) => ({ ...p, name: p.name.trim() }))
        .filter((p) => p.name),
    }));
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
      tripTeamSizeMin: form.tripTeamSizeMin === "" ? null : Number(form.tripTeamSizeMin),
      tripTeamSizeMax: form.tripTeamSizeMax === "" ? null : Number(form.tripTeamSizeMax),
      tripTypesSupported: cleanTripTypesSupported,
      orgTrips: cleanOrgTrips,
      churchVisits: cleanChurchVisits,
      supportEntries: cleanSupportEntries,
      needRequests: cleanSupportNeeds,
      addresses: {
        physical: hasAnyAddressValue(cleanPhysical) ? cleanPhysical : undefined,
        mailing: hasAnyAddressValue(form.addresses.mailing) ? form.addresses.mailing : undefined,
      },
    };

    try {
      const record = isEdit
        ? await updateOrganization(id, payload)
        : await createOrganization(payload);

      if (imageFile) {
        await uploadOrganizationImage(record.id, imageFile, imageReceivedDate);
      }

      navigate(`/admin/organizations/${record.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell form-has-floating-actions">
      <h2>{isEdit ? "Edit Organization" : "Add Organization"}</h2>
      <form onSubmit={handleSubmit} className="admin-form">
        <div className="admin-section">
          <h3>Logo</h3>
          <div className="headshot-row">
            {(imagePreview || currentPhotoUrl) && (
              <img
                src={imagePreview || currentPhotoUrl}
                alt="Logo preview"
                className="missionary-thumb"
                style={{ width: 80, height: 80 }}
              />
            )}
            <label style={{ flex: 1 }}>
              Logo Image
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
              Uploading here adds a new logo without deleting the current one —
              view the full history or delete an old logo from this
              organization's detail page.
            </p>
          )}
        </div>

        <div className="admin-section">
          <h3>Core Info</h3>
          <div className="form-grid">
            <label>
              Organization Name
              <input value={form.name} onChange={(e) => update("name", e.target.value)} required />
            </label>
            <label>
              Organization Type
              <select value={form.orgType} onChange={(e) => update("orgType", e.target.value)}>
                <option value="Local">Local</option>
                <option value="National">National</option>
              </select>
            </label>
            <label>
              Field / Region Display Name
              <input value={form.fieldDisplayName || ""} onChange={(e) => update("fieldDisplayName", e.target.value)} />
            </label>
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
          <h3>Financial Support</h3>
          <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "-0.5rem" }}>
            Monthly support amount over time — add a new entry whenever it changes, the most
            recent effective date is treated as the current amount. Admin-only, never shown on
            the public site.
          </p>
          {form.supportEntries.map((entry, i) => (
            <div className="repeatable-row" key={i}>
              <button type="button" className="btn-remove" onClick={() => removeSupportEntry(i)} title="Remove">
                ✕
              </button>
              <div className="form-grid">
                <label>
                  Monthly Amount ($)
                  <input
                    type="number"
                    min="0"
                    value={entry.amount}
                    onChange={(e) => updateSupportEntry(i, "amount", e.target.value)}
                  />
                </label>
                <label>
                  Effective Date
                  <input
                    type="date"
                    value={toDateInputValue(entry.effectiveDate)}
                    onChange={(e) => updateSupportEntry(i, "effectiveDate", e.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <input value={entry.notes || ""} onChange={(e) => updateSupportEntry(i, "notes", e.target.value)} />
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addSupportEntry}>
            + Add Support Entry
          </button>
        </div>

        <div className="admin-section">
          <h3>One-Time Needs</h3>
          <p style={{ fontSize: "0.85rem", color: "#555", marginTop: "-0.5rem" }}>
            One-off requests and what we actually approved — leave Approved Amount blank until a
            decision is made. Admin-only.
          </p>
          {form.needRequests.map((need, i) => (
            <div className="repeatable-row" key={i}>
              <button type="button" className="btn-remove" onClick={() => removeSupportNeed(i)} title="Remove">
                ✕
              </button>
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Description
                  <input
                    value={need.description}
                    onChange={(e) => updateSupportNeed(i, "description", e.target.value)}
                  />
                </label>
                <label>
                  Requested Amount ($)
                  <input
                    type="number"
                    min="0"
                    value={need.requestedAmount}
                    onChange={(e) => updateSupportNeed(i, "requestedAmount", e.target.value)}
                  />
                </label>
                <label>
                  Request Date
                  <input
                    type="date"
                    value={toDateInputValue(need.requestDate)}
                    onChange={(e) => updateSupportNeed(i, "requestDate", e.target.value)}
                  />
                </label>
                <label>
                  Approved Amount ($)
                  <input
                    type="number"
                    min="0"
                    value={need.approvedAmount}
                    onChange={(e) => updateSupportNeed(i, "approvedAmount", e.target.value)}
                    placeholder="Not yet decided"
                  />
                </label>
                <label>
                  Approved Date
                  <input
                    type="date"
                    value={toDateInputValue(need.approvedDate)}
                    onChange={(e) => updateSupportNeed(i, "approvedDate", e.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <input value={need.notes || ""} onChange={(e) => updateSupportNeed(i, "notes", e.target.value)} />
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addSupportNeed}>
            + Add Need
          </button>
        </div>

        <div className="admin-section">
          <h3>Contact Info</h3>
          <div className="form-grid">
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

        <div className="admin-section">
          <h3>Overview</h3>
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
            Focus Area
            <textarea rows={3} value={form.focusArea || ""} onChange={(e) => update("focusArea", e.target.value)} />
          </label>
        </div>

        <div className="admin-section">
          <h3>Serving Location</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: "0.85rem" }}>
            Where the organization actually operates — a full street address if known and safe to
            record, or just city/state/country. The GPS coordinates drive the public map pin
            (coarsened to a country-level pin automatically for restricted-access organizations).
            Leave the coordinates blank to have them looked up automatically from the address, or
            enter them manually for precise control. The rest of this address is admin-only and
            never shown on the public site.
          </p>
          <AddressFields
            value={form.addresses.physical}
            onChange={(addr) => updateNested("addresses", { ...form.addresses, physical: addr })}
            showGps
          />
          <label>
            Country Code (FIPS/ISO)
            <input value={form.fipsCountryCode || ""} onChange={(e) => update("fipsCountryCode", e.target.value)} />
          </label>
          <p style={{ marginTop: "0.4rem", color: "#666", fontSize: "0.85rem" }}>
            Used to look up Joshua Project country statistics below. Required for that lookup to
            work — it is not inferred from the physical address.
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
          />
        </div>

        <div className="admin-section">
          <h3>Trip Capacity</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: "0.85rem" }}>
            What kind of short-term mission team this organization is set up to host.
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

        <div className="admin-section">
          <h3>Trip History</h3>
          {form.orgTrips.map((trip, tripIndex) => (
            <div className="repeatable-row" key={tripIndex}>
              <button type="button" className="btn-remove" onClick={() => removeTrip(tripIndex)} title="Remove">
                ✕
              </button>
              <div className="form-grid">
                <label>
                  Start Date
                  <input
                    type="date"
                    value={toDateInputValue(trip.startDate)}
                    onChange={(e) => updateTrip(tripIndex, "startDate", e.target.value)}
                  />
                </label>
                <label>
                  End Date
                  <input
                    type="date"
                    value={toDateInputValue(trip.endDate)}
                    onChange={(e) => updateTrip(tripIndex, "endDate", e.target.value)}
                  />
                </label>
                <label>
                  Trip Type
                  <PresetOrCustomSelect
                    value={trip.tripType}
                    onChange={(val) => updateTrip(tripIndex, "tripType", val)}
                    presets={TRIP_TYPE_PRESETS}
                    placeholder="e.g. Photography"
                  />
                </label>
              </div>
              <label style={{ marginTop: "0.75rem" }}>
                Description (what the team did)
                <textarea
                  rows={2}
                  value={trip.description || ""}
                  onChange={(e) => updateTrip(tripIndex, "description", e.target.value)}
                />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Notes
                <textarea rows={2} value={trip.notes || ""} onChange={(e) => updateTrip(tripIndex, "notes", e.target.value)} />
              </label>

              <h4 style={{ marginTop: "1rem" }}>Participants</h4>
              {(trip.participants || []).map((p, pIndex) => (
                <div className="repeatable-row" key={pIndex} style={{ background: "white" }}>
                  <button
                    type="button"
                    className="btn-remove"
                    onClick={() => removeParticipant(tripIndex, pIndex)}
                    title="Remove"
                  >
                    ✕
                  </button>
                  <div className="form-grid">
                    <label>
                      Name
                      <input
                        value={p.name || ""}
                        onChange={(e) => updateParticipant(tripIndex, pIndex, "name", e.target.value)}
                      />
                    </label>
                    <label>
                      Role
                      <input
                        value={p.role || ""}
                        onChange={(e) => updateParticipant(tripIndex, pIndex, "role", e.target.value)}
                        placeholder="e.g. Construction"
                      />
                    </label>
                    <label>
                      Phone
                      <input
                        value={p.phone || ""}
                        onChange={(e) => updateParticipant(tripIndex, pIndex, "phone", e.target.value)}
                      />
                    </label>
                    <label>
                      Email
                      <input
                        value={p.email || ""}
                        onChange={(e) => updateParticipant(tripIndex, pIndex, "email", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="admin-checkbox-row" style={{ marginTop: "0.5rem" }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!p.isLeader}
                        onChange={(e) => updateParticipant(tripIndex, pIndex, "isLeader", e.target.checked)}
                      />
                      Trip Leader
                    </label>
                  </div>
                </div>
              ))}
              <button type="button" className="btn secondary small" onClick={() => addParticipant(tripIndex)}>
                + Add Participant
              </button>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addTrip}>
            + Add Trip
          </button>
        </div>

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

        <div className="form-save-bar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => navigate(isEdit ? `/admin/organizations/${id}` : "/admin/partners")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
