import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchPartner,
  updatePartner,
  fetchPrayerRequests,
  fetchNewsletters,
  fetchDocuments,
  fetchSupportEntries,
  fetchSupportNeeds,
  fetchTrips,
} from "../api/client.js";
import CountryStats from "../components/CountryStats.jsx";
import NewsletterSection from "../components/admin/NewsletterSection.jsx";
import PrayerRequestSection from "../components/admin/PrayerRequestSection.jsx";
import DocumentSection from "../components/admin/DocumentSection.jsx";
import PhotoHistorySection from "../components/admin/PhotoHistorySection.jsx";
import PartnerTripSection from "../components/admin/PartnerTripSection.jsx";
import PartnerFinancialSection from "../components/admin/PartnerFinancialSection.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import AddressFields from "../components/admin/AddressFields.jsx";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import { getFipsCode } from "../utils/countryFipsCodes.js";
import { formatDateLong, toDateInputValue, todayInputValue } from "../utils/format.js";
import { addressByType } from "../utils/addresses.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";

// A cleared <input type="date"> is "", which `z.coerce.date()` turns into an
// Invalid Date and rejects -- "no date" has to travel as null.
const dateOrNull = (value) => value || null;

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

// An address the user never filled in shouldn't be persisted as a row of
// empty strings -- the API treats a present `physical`/`mailing` key as
// "this address exists", so an untouched one is sent as undefined instead.
function hasAnyAddressValue(address) {
  return (
    Object.keys(emptyAddress).some((key) => Boolean(address[key] && String(address[key]).trim())) ||
    Boolean(address.receiveMail) ||
    Boolean(address.receivePackages) ||
    address.gpsLat != null ||
    address.gpsLng != null
  );
}

// GPS comes back from a number input as a string; the API wants a number
// or null.
function cleanAddress(address) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const cleaned = { ...address, gpsLat: num(address.gpsLat), gpsLng: num(address.gpsLng) };
  return hasAnyAddressValue(cleaned) ? cleaned : undefined;
}

// Renders a labeled value, hiding itself when empty unless `showEmpty` --
// keeps free-form sections free of "Field: —" clutter while fixed field sets
// still show what could be filled in.
function Field({ label, value, showEmpty = false }) {
  const isEmpty = value === null || value === undefined || value === "";
  if (isEmpty && !showEmpty) return null;
  return (
    <div>
      <div
        style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.03em" }}
      >
        {label}
      </div>
      <div style={isEmpty ? { color: "#aaa" } : undefined}>{isEmpty ? "—" : value}</div>
    </div>
  );
}

function AddressSummary({ address }) {
  const a = address || {};
  const lines = [a.addressLine1, a.addressLine2].filter(Boolean);
  const cityLine = [a.city, a.stateProvinceRegion, a.postalCode].filter(Boolean).join(", ");
  if (!lines.length && !cityLine && !a.country) return <p style={{ color: "#888" }}>Not on file.</p>;
  return (
    <div>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
      {cityLine && <div>{cityLine}</div>}
      {a.country && <div>{a.country}</div>}
      {(a.receiveMail || a.receivePackages) && (
        <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", color: "#666" }}>
          {[a.receiveMail && "Receives mail here", a.receivePackages && "Receives packages here"]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {a.gpsLat != null && a.gpsLng != null && (
        <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", color: "#666" }}>
          GPS: {a.gpsLat}, {a.gpsLng}
        </div>
      )}
    </div>
  );
}

// A small editor for a list of objects -- adults, children, furloughs,
// church visits. These are replaced wholesale when their key is sent, which
// is safe because this page is their only writer.
function RepeatableRows({ rows, onChange, blank, render }) {
  return (
    <>
      {rows.map((row, i) => (
        <div className="repeatable-row" key={i}>
          <button
            type="button"
            className="btn-remove"
            title="Remove"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            ✕
          </button>
          {render(row, (field, value) => {
            const next = [...rows];
            next[i] = { ...next[i], [field]: value };
            onChange(next);
          })}
        </div>
      ))}
      <button type="button" className="btn secondary small" onClick={() => onChange([...rows, { ...blank }])}>
        + Add
      </button>
    </>
  );
}

// The partner page *is* the record: every section saves only its own fields
// through the partial PUT, rather than routing everything through one
// whole-record form. See EditableSection for the reasoning.
export default function AdminPartnerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [collections, setCollections] = useState({
    prayerRequests: [],
    newsletters: [],
    documents: [],
    supportEntries: [],
    needRequests: [],
    trips: [],
  });
  const { churchName, enabledFeatures } = useSettings();

  // React Router keeps this same component instance mounted across a
  // /partners/:id param change -- it doesn't remount. reload() is passed
  // as onSaved/onChange to nearly every section on this page, so a save on
  // partner A that's still in flight when the admin navigates to partner B
  // would otherwise land A's data on B's screen once it resolves. idRef is
  // kept current every render (not just via reload's own closure) so a
  // reload() call can tell, when it finally resolves, whether the id it
  // was fetching for is still the one being viewed.
  const idRef = useRef(id);
  idRef.current = id;

  function reload() {
    const requestId = id;
    return Promise.all([
      fetchPartner(id).then((data) => {
        if (idRef.current === requestId) setP(data);
      }),
      Promise.all([
        fetchPrayerRequests({ partnerId: id }),
        fetchNewsletters({ partnerId: id }),
        fetchDocuments({ partnerId: id }),
        fetchSupportEntries({ partnerId: id }),
        fetchSupportNeeds({ partnerId: id }),
        enabledFeatures.trips ? fetchTrips({ partnerId: id }) : Promise.resolve([]),
      ]).then(([prayerRequests, newsletters, documents, supportEntries, needRequests, trips]) => {
        if (idRef.current === requestId) {
          setCollections({ prayerRequests, newsletters, documents, supportEntries, needRequests, trips });
        }
      }),
    ]);
  }

  useEffect(() => {
    reload().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Called unconditionally, before the loading guard below, so the number
  // of hooks this component calls doesn't change between the "still
  // loading" render (p is null) and every render after -- see Rules of
  // Hooks. useLoadMore itself treats a null/undefined list as empty.
  const churchVisitsLoadMore = useLoadMore(p?.churchVisits);
  const furloughsLoadMore = useLoadMore(p?.furloughs);

  if (!p) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const isOrg = p.kind === "organization";
  const save = (patch) => updatePartner(id, patch);

  const physical = addressByType(p.addresses, "physical") || {};
  const mailing = addressByType(p.addresses, "mailing") || {};

  // Addresses are replaced as a pair on the server, so a section editing one
  // of them has to send the other back untouched or it would be deleted.
  const saveAddress = (type) => (draft) => {
    const { address, fipsCountryCode, ...rest } = draft;
    return save({
      addresses: {
        physical: cleanAddress(type === "physical" ? address : physical),
        mailing: cleanAddress(type === "mailing" ? address : mailing),
      },
      ...(type === "physical" ? { fipsCountryCode: fipsCountryCode || null } : {}),
      ...rest,
    });
  };

  // The user's calendar date, not UTC's: comparing against the UTC date made
  // a furlough starting tomorrow read as already active for the last hours
  // of the day west of UTC.
  const today = todayInputValue();
  const activeFurlough = (p.furloughs || []).find((f) => {
    const start = String(f.startDate).slice(0, 10);
    const end = f.endDate ? String(f.endDate).slice(0, 10) : null;
    return start <= today && (!end || end >= today);
  });

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ marginBottom: "0.25rem" }}>{p.displayName}</h2>
          <p style={{ color: "#666", margin: 0 }}>
            {isOrg ? `${p.orgType || "Partner"} Organization` : "Missionary"}
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => navigate("/admin/partners")}>
          Back to list
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "1rem 0" }}>
        {!isOrg && (
          <span className={`status-pill ${p.contactSafe ? "good" : "warn"}`}>
            {p.contactSafe ? "Safe to contact" : "Not safe to contact"}
          </span>
        )}
        <span className="status-pill">{p.isPublic ? "Shown on public site" : "Not public"}</span>
        {p.isRestricted && <span className="status-pill warn">Restricted-access</span>}
        {!isOrg && (
          <span
            className={`status-pill ${p.sentByOurChurch ? "good" : ""}`}
            title="Edit in the Sending Church box below to change this."
          >
            {p.sentByOurChurch
              ? `Sent by ${churchName || "our church"}`
              : `Not sent by ${churchName || "our church"}`}
          </span>
        )}
        {activeFurlough && <span className="status-pill warn">On Furlough</span>}
        {p.archived && <span className="status-pill warn">Archived {formatDateLong(p.archivedAt)}</span>}
      </div>

      <div className="admin-form">
        <EditableSection
          title="Status &amp; Visibility"
          onSaved={reload}
          onSave={save}
          value={{
            isPublic: p.isPublic,
            isRestricted: p.isRestricted,
            ...(!isOrg ? { contactSafe: p.contactSafe } : {}),
          }}
          view={(v) => (
            <div className="admin-checkbox-row">
              <Field label="Shown on public site" value={v.isPublic ? "Yes" : "No"} />
              <Field label="Restricted-access location" value={v.isRestricted ? "Yes" : "No"} />
              {!isOrg && <Field label="Safe to Contact" value={v.contactSafe ? "Yes" : "No"} />}
            </div>
          )}
          edit={(d, set) => (
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={d.isPublic}
                  onChange={(e) => set("isPublic", e.target.checked)}
                />
                Show on public site
              </label>
              <label title="Masks the name to initials and coarsens the map pin to a country centroid on the public site.">
                <input
                  type="checkbox"
                  checked={d.isRestricted}
                  onChange={(e) => set("isRestricted", e.target.checked)}
                />
                Restricted-access location
              </label>
              {!isOrg && (
                <label>
                  <input
                    type="checkbox"
                    checked={d.contactSafe}
                    onChange={(e) => set("contactSafe", e.target.checked)}
                  />
                  Safe to contact
                </label>
              )}
            </div>
          )}
        />

        <PhotoHistorySection partnerId={p.id} photos={p.photos} onChange={reload} />

        <EditableSection
          title="Ministry Overview"
          onSaved={reload}
          onSave={save}
          value={{
            overviewShort: p.overviewShort || "",
            overview: p.overview || "",
            focusArea: p.focusArea || "",
          }}
          view={(v) => (
            <>
              <Field label="Short Overview" value={v.overviewShort} showEmpty />
              <div style={{ marginTop: "0.75rem" }}>
                <Field label="Full Overview" value={v.overview} showEmpty />
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <Field label="Ministry Focus" value={v.focusArea} showEmpty />
              </div>
            </>
          )}
          edit={(d, set) => (
            <>
              <label>
                Short Overview (one or two lines, used on directory cards)
                <input value={d.overviewShort} onChange={(e) => set("overviewShort", e.target.value)} />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Full Overview
                <textarea rows={5} value={d.overview} onChange={(e) => set("overview", e.target.value)} />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Ministry Focus
                <textarea rows={2} value={d.focusArea} onChange={(e) => set("focusArea", e.target.value)} />
              </label>
            </>
          )}
        />

        <div className="admin-section-group">
          <h2 className="admin-group-heading">Family &amp; Personal</h2>

          {!isOrg && (
            <EditableSection
              title="Family"
              onSaved={reload}
              onSave={(d) =>
                save({
                  anniversary: dateOrNull(d.anniversary),
                  // Drop rows the user added but never named, rather than
                  // persisting a blank person.
                  adults: d.adults
                    .map((a) => ({ ...a, name: (a.name || "").trim(), birthday: dateOrNull(a.birthday) }))
                    .filter((a) => a.name),
                  children: d.children
                    .map((c) => ({ ...c, name: (c.name || "").trim(), birthday: dateOrNull(c.birthday) }))
                    .filter((c) => c.name),
                })
              }
              value={{
                anniversary: toDateInputValue(p.anniversary),
                adults: (p.adults || []).map((a) => ({ ...a, birthday: toDateInputValue(a.birthday) })),
                children: (p.children || []).map((c) => ({ ...c, birthday: toDateInputValue(c.birthday) })),
              }}
              view={() => (
                <>
                  <div style={{ marginBottom: "1rem" }}>
                    <Field label="Wedding Anniversary" value={formatDateLong(p.anniversary)} showEmpty />
                  </div>
                  {p.adults?.map((a) => (
                    <div key={a.id} className="repeatable-row">
                      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                        <Field label="Name" value={a.name} />
                        <Field label="Birthday" value={formatDateLong(a.birthday)} />
                        <Field label="Phone 1" value={a.phone1} />
                        <Field label="Phone 2" value={a.phone2} />
                        <Field label="Email" value={a.email} />
                      </div>
                    </div>
                  ))}
                  {p.children?.map((c) => (
                    <div key={c.id} className="repeatable-row">
                      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center" }}>
                        <span className="status-pill">Child</span>
                        <Field label="Name" value={c.name} />
                        <Field label="Birthday" value={formatDateLong(c.birthday)} />
                      </div>
                    </div>
                  ))}
                  {!p.adults?.length && !p.children?.length && <p style={{ color: "#888" }}>None on file.</p>}
                </>
              )}
              edit={(d, set) => (
                <>
                  <label style={{ maxWidth: "220px", marginBottom: "1rem" }}>
                    Wedding Anniversary
                    <input
                      type="date"
                      value={d.anniversary}
                      onChange={(e) => set("anniversary", e.target.value)}
                    />
                  </label>
                  <h4>Adults</h4>
                  <RepeatableRows
                    rows={d.adults}
                    onChange={(rows) => set("adults", rows)}
                    blank={{ name: "", phone1: "", phone2: "", email: "", birthday: "" }}
                    render={(row, setField) => (
                      <div className="form-grid">
                        <label>
                          Name
                          <input value={row.name || ""} onChange={(e) => setField("name", e.target.value)} />
                        </label>
                        <label>
                          Birthday
                          <input
                            type="date"
                            value={row.birthday || ""}
                            onChange={(e) => setField("birthday", e.target.value)}
                          />
                        </label>
                        <label>
                          Phone 1
                          <input
                            value={row.phone1 || ""}
                            onChange={(e) => setField("phone1", e.target.value)}
                          />
                        </label>
                        <label>
                          Phone 2
                          <input
                            value={row.phone2 || ""}
                            onChange={(e) => setField("phone2", e.target.value)}
                          />
                        </label>
                        <label>
                          Email
                          <input
                            value={row.email || ""}
                            onChange={(e) => setField("email", e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  />
                  <h4 style={{ marginTop: "1rem" }}>Children</h4>
                  <RepeatableRows
                    rows={d.children}
                    onChange={(rows) => set("children", rows)}
                    blank={{ name: "", birthday: "" }}
                    render={(row, setField) => (
                      <div className="form-grid">
                        <label>
                          Name
                          <input value={row.name || ""} onChange={(e) => setField("name", e.target.value)} />
                        </label>
                        <label>
                          Birthday
                          <input
                            type="date"
                            value={row.birthday || ""}
                            onChange={(e) => setField("birthday", e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  />
                </>
              )}
            />
          )}

          {!isOrg && (
            <EditableSection
              title="Languages Spoken"
              onSaved={reload}
              onSave={(d) =>
                save({ languagesSpoken: d.languagesSpoken.map((l) => l.trim()).filter(Boolean) })
              }
              value={{ languagesSpoken: p.languagesSpoken || [] }}
              view={(v) =>
                v.languagesSpoken.length ? (
                  <p>{v.languagesSpoken.join(", ")}</p>
                ) : (
                  <p style={{ color: "#888" }}>None on file.</p>
                )
              }
              edit={(d, set) => (
                <RepeatableRows
                  rows={d.languagesSpoken.map((l) => ({ value: l }))}
                  onChange={(rows) =>
                    set(
                      "languagesSpoken",
                      rows.map((r) => r.value ?? "")
                    )
                  }
                  blank={{ value: "" }}
                  render={(row, setField) => (
                    <input
                      value={row.value || ""}
                      onChange={(e) => setField("value", e.target.value)}
                      placeholder="e.g. Swahili"
                    />
                  )}
                />
              )}
            />
          )}

          {!isOrg && (
            <EditableSection
              title="Emergency Contact"
              onSaved={reload}
              onSave={(d) => save({ emergencyContact: d })}
              value={{
                name: p.emergencyContact?.name || "",
                phone: p.emergencyContact?.phone || "",
                email: p.emergencyContact?.email || "",
              }}
              view={(v) => (
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <Field label="Name" value={v.name} showEmpty />
                  <Field label="Phone" value={v.phone} showEmpty />
                  <Field label="Email" value={v.email} showEmpty />
                </div>
              )}
              edit={(d, set) => (
                <div className="form-grid">
                  <label>
                    Name
                    <input value={d.name} onChange={(e) => set("name", e.target.value)} />
                  </label>
                  <label>
                    Phone
                    <input value={d.phone} onChange={(e) => set("phone", e.target.value)} />
                  </label>
                  <label>
                    Email
                    <input value={d.email} onChange={(e) => set("email", e.target.value)} />
                  </label>
                </div>
              )}
            />
          )}
        </div>

        <div className="admin-section-group">
          <h2 className="admin-group-heading">Location &amp; Contact</h2>

          <EditableSection
            title="Serving Location"
            onSaved={reload}
            onSave={saveAddress("physical")}
            value={{
              address: { ...emptyAddress, ...physical },
              fipsCountryCode: p.fipsCountryCode || "",
              fieldDisplayName: p.fieldDisplayName || "",
            }}
            view={(v) => (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
                  <Field label="Field / Region" value={v.fieldDisplayName} showEmpty />
                  {enabledFeatures.joshuaProject && (
                    <Field label="Country Code" value={p.fipsCountryCode} showEmpty />
                  )}
                </div>
                <div style={{ marginTop: "0.75rem" }}>
                  <AddressSummary address={physical} />
                </div>
                {enabledFeatures.joshuaProject && p.fipsCountryCode && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <CountryStats countryCode={p.fipsCountryCode} />
                  </div>
                )}
              </>
            )}
            edit={(d, set) => (
              <>
                <div className="form-grid">
                  <label>
                    Field / Region Display Name
                    <input
                      value={d.fieldDisplayName}
                      onChange={(e) => set("fieldDisplayName", e.target.value)}
                    />
                    {/* This field is published even for a restricted partner --
                        see toPublicPartner in backend/src/utils/maskData.js. The
                        masking hides the name and coarsens the map pin to a
                        country centroid, so a sub-national region typed here
                        gives back most of what the masking just removed.
                        isRestricted itself now lives in Status & Visibility,
                        so this reads the partner record directly. */}
                    {p.isRestricted && (
                      <span className="field-warning">
                        Shown publicly, even though this partner is restricted. Their name is masked to
                        initials and the map pin is coarsened to the country — so keep this broad (&ldquo;East
                        Africa&rdquo;), not a region or city that narrows it back down.
                      </span>
                    )}
                  </label>
                  {enabledFeatures.joshuaProject && (
                    <label title="Looks up Joshua Project's country statistics for this field/region -- nothing else uses this field. Auto-fills from the country entered below, but Joshua Project uses the older FIPS codes, not ISO -- they disagree for some countries, so correct it here if the stats below look wrong.">
                      Country Code (FIPS/ISO)
                      <input
                        value={d.fipsCountryCode}
                        onChange={(e) => set("fipsCountryCode", e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <AddressFields
                  idPrefix="physical"
                  value={d.address}
                  onChange={(addr) => {
                    set("address", addr);
                    // Fill the FIPS code from a recognized country name, but
                    // never overwrite one that's already there -- FIPS and ISO
                    // disagree for many countries and the existing value may
                    // be a deliberate choice.
                    if (!d.fipsCountryCode && addr.country !== d.address.country) {
                      const fips = getFipsCode(addr.country);
                      if (fips) set("fipsCountryCode", fips);
                    }
                  }}
                  showGps
                />
              </>
            )}
          />

          <EditableSection
            title="Mailing &amp; Contact Address"
            onSaved={reload}
            onSave={saveAddress("mailing")}
            value={{
              address: { ...emptyAddress, receiveMail: false, receivePackages: false, ...mailing },
              displayName: p.displayName,
              orgType: p.orgType || "Local",
              preferredContactMethod: p.preferredContactMethod || "",
              contactName: p.contactName || "",
              contactPhone: p.contactPhone || "",
              contactEmail: p.contactEmail || "",
            }}
            view={(v) => (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
                  <Field
                    label={isOrg ? "Organization Name" : "Display Name"}
                    value={v.displayName}
                    showEmpty
                  />
                  <Field label="Preferred Contact Method" value={v.preferredContactMethod} showEmpty />
                </div>
                {isOrg && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", marginTop: "0.75rem" }}>
                    <Field label="Contact Name" value={v.contactName} showEmpty />
                    <Field label="Contact Phone" value={v.contactPhone} showEmpty />
                    <Field label="Contact Email" value={v.contactEmail} showEmpty />
                  </div>
                )}
                <div style={{ marginTop: "0.75rem" }}>
                  <AddressSummary address={mailing} />
                </div>
              </>
            )}
            edit={(d, set) => (
              <>
                <div className="form-grid">
                  <label title="The public display name shown on the directory, map, and booklet.">
                    {isOrg ? "Organization Name" : "Display Name"}
                    <input
                      value={d.displayName}
                      onChange={(e) => set("displayName", e.target.value)}
                      required
                    />
                  </label>
                  {isOrg && (
                    <label>
                      Organization Type
                      <select value={d.orgType} onChange={(e) => set("orgType", e.target.value)}>
                        <option value="Local">Local</option>
                        <option value="National">National</option>
                      </select>
                    </label>
                  )}
                  <label>
                    Preferred Contact Method
                    <PresetOrCustomSelect
                      value={d.preferredContactMethod}
                      onChange={(v) => set("preferredContactMethod", v)}
                      presets={CONTACT_METHOD_PRESETS}
                      placeholder="e.g. Telegram"
                    />
                  </label>
                  {isOrg && (
                    <>
                      <label>
                        Contact Name
                        <input value={d.contactName} onChange={(e) => set("contactName", e.target.value)} />
                      </label>
                      <label>
                        Contact Phone
                        <input value={d.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
                      </label>
                      <label>
                        Contact Email
                        <input value={d.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
                      </label>
                    </>
                  )}
                </div>
                <div style={{ marginTop: "1rem" }}>
                  <AddressFields
                    idPrefix="mailing"
                    value={d.address}
                    onChange={(addr) => set("address", addr)}
                    showMailFlags
                  />
                </div>
              </>
            )}
          />

          {!isOrg &&
            [
              { key: "sendingChurch", title: "Sending Church" },
              { key: "sendingOrg", title: "Sending Org" },
            ].map(({ key, title }) => (
              <EditableSection
                key={key}
                title={title}
                onSaved={reload}
                onSave={(d) => {
                  const { sentByOurChurch, ...rest } = d;
                  return save({
                    [key]: rest,
                    ...(key === "sendingChurch" ? { sentByOurChurch } : {}),
                  });
                }}
                value={{
                  name: p[key]?.name || "",
                  contactName: p[key]?.contactName || "",
                  contactEmail: p[key]?.contactEmail || "",
                  phone: p[key]?.phone || "",
                  websiteLink: p[key]?.websiteLink || "",
                  mailingAddress: { ...emptyAddress, ...(p[key]?.mailingAddress || {}) },
                  ...(key === "sendingChurch" ? { sentByOurChurch: p.sentByOurChurch } : {}),
                }}
                view={(v) => (
                  <>
                    {key === "sendingChurch" && (
                      <div style={{ marginBottom: v.name ? "0.75rem" : 0 }}>
                        <Field
                          label={`Sent by ${churchName || "our church"}`}
                          value={v.sentByOurChurch ? "Yes" : "No"}
                        />
                      </div>
                    )}
                    {v.name ? (
                      <>
                        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                          <Field label="Name" value={v.name} />
                          <Field label="Contact" value={v.contactName} />
                          <Field label="Contact Email" value={v.contactEmail} />
                          <Field label="Phone" value={v.phone} />
                          <Field
                            label="Website"
                            value={
                              v.websiteLink ? (
                                <a href={v.websiteLink} target="_blank" rel="noreferrer">
                                  {v.websiteLink}
                                </a>
                              ) : null
                            }
                          />
                        </div>
                        <div style={{ marginTop: "0.75rem" }}>
                          <AddressSummary address={v.mailingAddress} />
                        </div>
                      </>
                    ) : (
                      <p style={{ color: "#888" }}>Not on file.</p>
                    )}
                  </>
                )}
                edit={(d, set) => (
                  <>
                    {key === "sendingChurch" && (
                      <div className="admin-checkbox-row" style={{ marginBottom: "1rem" }}>
                        <label title="Fills in the Sending Church section below from this church's own info, overwriting anything already there. A later Church Settings change doesn't update this on its own -- use the bulk update on the About Church page for that. Unchecking never clears what's there.">
                          <input
                            type="checkbox"
                            checked={d.sentByOurChurch}
                            onChange={(e) => set("sentByOurChurch", e.target.checked)}
                          />
                          Sent by {churchName || "our church"}
                        </label>
                      </div>
                    )}
                    <div className="form-grid">
                      <label>
                        Name
                        <input value={d.name} onChange={(e) => set("name", e.target.value)} />
                      </label>
                      <label>
                        Contact Name
                        <input value={d.contactName} onChange={(e) => set("contactName", e.target.value)} />
                      </label>
                      <label>
                        Contact Email
                        <input value={d.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
                      </label>
                      <label>
                        Phone
                        <input value={d.phone} onChange={(e) => set("phone", e.target.value)} />
                      </label>
                      <label>
                        Website
                        <input value={d.websiteLink} onChange={(e) => set("websiteLink", e.target.value)} />
                      </label>
                    </div>
                    <h4 style={{ marginTop: "1rem" }}>Mailing Address</h4>
                    <AddressFields
                      idPrefix={key}
                      value={d.mailingAddress}
                      onChange={(addr) => set("mailingAddress", addr)}
                    />
                  </>
                )}
              />
            ))}

          <EditableSection
            title="Links &amp; Social Media"
            onSaved={reload}
            onSave={save}
            value={{
              websiteLink: p.websiteLink || "",
              supportLink: p.supportLink || "",
              newsletterSignup: p.newsletterSignup || "",
              facebook: p.facebook || "",
              twitter: p.twitter || "",
              instagram: p.instagram || "",
              linkedin: p.linkedin || "",
            }}
            view={(v) => {
              const links = [
                ["websiteLink", "Website"],
                ["supportLink", "Support / Donate"],
                ["newsletterSignup", "Newsletter Signup"],
                ["facebook", "Facebook"],
                ["twitter", "Twitter"],
                ["instagram", "Instagram"],
                ["linkedin", "LinkedIn"],
              ].filter(([k]) => v[k]);
              if (!links.length) return <p style={{ color: "#888" }}>None on file.</p>;
              return (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {links.map(([k, label]) => (
                    <a key={k} href={v[k]} target="_blank" rel="noreferrer" className="btn secondary small">
                      {label}
                    </a>
                  ))}
                </div>
              );
            }}
            edit={(d, set) => (
              <div className="form-grid">
                {[
                  ["websiteLink", "Website"],
                  ["supportLink", "Support / Donate Link"],
                  ["newsletterSignup", "Newsletter Signup"],
                  ["facebook", "Facebook"],
                  ["twitter", "Twitter"],
                  ["instagram", "Instagram"],
                  ["linkedin", "LinkedIn"],
                ].map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input value={d[k]} onChange={(e) => set(k, e.target.value)} />
                  </label>
                ))}
              </div>
            )}
          />
        </div>

        {(enabledFeatures.monthlySupport || enabledFeatures.oneTimeNeeds) && (
          <div className="admin-section-group">
            <h2 className="admin-group-heading">Financial</h2>
            <PartnerFinancialSection
              partnerId={p.id}
              supportEntries={collections.supportEntries}
              needRequests={collections.needRequests}
              newsletters={collections.newsletters}
              documents={collections.documents}
              showMonthlySupport={enabledFeatures.monthlySupport}
              showOneTimeNeeds={enabledFeatures.oneTimeNeeds}
              supportingSince={p.supportingSince}
              onSaveSupportingSince={(date) => save({ supportingSince: dateOrNull(date) })}
              onChange={reload}
            />
          </div>
        )}

        <div className="admin-section-group">
          <h2 className="admin-group-heading">Mission Trips</h2>

          {enabledFeatures.trips && (
            <PartnerTripSection partnerId={p.id} trips={collections.trips} onChange={reload} />
          )}

          <EditableSection
            title="Trip Capacity"
            onSaved={reload}
            onSave={(d) =>
              save({
                tripTeamSizeMin: d.tripTeamSizeMin === "" ? null : Number(d.tripTeamSizeMin),
                tripTeamSizeMax: d.tripTeamSizeMax === "" ? null : Number(d.tripTeamSizeMax),
                tripTypesSupported: d.tripTypesSupported.map((t) => t.trim()).filter(Boolean),
                tripSeasonNotes: d.tripSeasonNotes || null,
                tripLogisticsNotes: d.tripLogisticsNotes || null,
              })
            }
            value={{
              tripTeamSizeMin: p.tripTeamSizeMin ?? "",
              tripTeamSizeMax: p.tripTeamSizeMax ?? "",
              tripTypesSupported: p.tripTypesSupported || [],
              tripSeasonNotes: p.tripSeasonNotes || "",
              tripLogisticsNotes: p.tripLogisticsNotes || "",
            }}
            view={(v) => (
              <>
                <Field
                  label="Team Size"
                  value={
                    v.tripTeamSizeMin !== "" || v.tripTeamSizeMax !== ""
                      ? `${v.tripTeamSizeMin === "" ? "?" : v.tripTeamSizeMin} – ${
                          v.tripTeamSizeMax === "" ? "?" : v.tripTeamSizeMax
                        }`
                      : null
                  }
                  showEmpty
                />
                <div style={{ marginTop: "0.75rem" }}>
                  <Field
                    label="Trip Types Supported"
                    value={v.tripTypesSupported.length ? v.tripTypesSupported.join(", ") : null}
                    showEmpty
                  />
                </div>
                <div style={{ marginTop: "0.75rem" }}>
                  <Field label="Best Time of Year / Duration Notes" value={v.tripSeasonNotes} />
                  <Field label="Lodging &amp; Logistics Notes" value={v.tripLogisticsNotes} />
                </div>
              </>
            )}
            edit={(d, set) => (
              <>
                <div className="form-grid">
                  <label>
                    Min Team Size
                    <input
                      type="number"
                      min="0"
                      value={d.tripTeamSizeMin}
                      onChange={(e) => set("tripTeamSizeMin", e.target.value)}
                    />
                  </label>
                  <label>
                    Max Team Size
                    <input
                      type="number"
                      min="0"
                      value={d.tripTeamSizeMax}
                      onChange={(e) => set("tripTeamSizeMax", e.target.value)}
                    />
                  </label>
                </div>
                <h4 style={{ marginTop: "1rem" }}>Trip Types Supported</h4>
                <RepeatableRows
                  rows={d.tripTypesSupported.map((t) => ({ value: t }))}
                  onChange={(rows) =>
                    set(
                      "tripTypesSupported",
                      rows.map((r) => r.value ?? "")
                    )
                  }
                  blank={{ value: "" }}
                  render={(row, setField) => (
                    <PresetOrCustomSelect
                      value={row.value}
                      onChange={(v) => setField("value", v)}
                      presets={TRIP_TYPE_PRESETS}
                      placeholder="e.g. Photography"
                    />
                  )}
                />
                <label style={{ marginTop: "1rem" }}>
                  Best Time of Year / Duration Notes
                  <textarea
                    rows={2}
                    value={d.tripSeasonNotes}
                    onChange={(e) => set("tripSeasonNotes", e.target.value)}
                  />
                </label>
                <label style={{ marginTop: "0.75rem" }}>
                  Lodging &amp; Logistics Notes
                  <textarea
                    rows={2}
                    value={d.tripLogisticsNotes}
                    onChange={(e) => set("tripLogisticsNotes", e.target.value)}
                  />
                </label>
              </>
            )}
          />
        </div>

        <div className="admin-section-group">
          <h2 className="admin-group-heading">Communication</h2>

          {enabledFeatures.prayerRequests && (
            <PrayerRequestSection
              partnerId={p.id}
              prayerRequests={collections.prayerRequests}
              newsletters={collections.newsletters}
              documents={collections.documents}
              onChange={reload}
            />
          )}

          {enabledFeatures.newsletters && (
            <NewsletterSection partnerId={p.id} newsletters={collections.newsletters} onChange={reload} />
          )}

          {enabledFeatures.documents && (
            <DocumentSection partnerId={p.id} documents={collections.documents} onChange={reload} />
          )}

          <EditableSection
            title="Church Visits"
            onSaved={reload}
            onSave={(d) =>
              save({
                churchVisits: d.churchVisits
                  .filter((v) => v.visitDate)
                  .map((v) => ({ visitDate: v.visitDate, notes: v.notes || null })),
              })
            }
            value={{
              churchVisits: (p.churchVisits || []).map((v) => ({
                visitDate: toDateInputValue(v.visitDate),
                notes: v.notes || "",
              })),
            }}
            view={() => (
              <>
                <div style={{ marginBottom: "1rem" }}>
                  <Field
                    label="Last Visit"
                    value={p.churchVisits?.[0] ? formatDateLong(p.churchVisits[0].visitDate) : null}
                    showEmpty
                  />
                </div>
                {p.churchVisits?.length ? (
                  <>
                    {churchVisitsLoadMore.visible.map((v) => (
                      <div key={v.id} className="repeatable-row">
                        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                          <Field label="Visit Date" value={formatDateLong(v.visitDate)} showEmpty />
                          <Field label="Notes" value={v.notes} />
                        </div>
                      </div>
                    ))}
                    <LoadMoreButton
                      hasMore={churchVisitsLoadMore.hasMore}
                      remaining={churchVisitsLoadMore.remaining}
                      onClick={churchVisitsLoadMore.showMore}
                      size="small"
                    />
                  </>
                ) : (
                  <p style={{ color: "#888" }}>No visits on file.</p>
                )}
              </>
            )}
            edit={(d, set) => (
              <RepeatableRows
                rows={d.churchVisits}
                onChange={(rows) => set("churchVisits", rows)}
                blank={{ visitDate: "", notes: "" }}
                render={(row, setField) => (
                  <div className="form-grid">
                    <label>
                      Visit Date
                      <input
                        type="date"
                        value={row.visitDate || ""}
                        onChange={(e) => setField("visitDate", e.target.value)}
                      />
                    </label>
                    <label>
                      Notes
                      <input value={row.notes || ""} onChange={(e) => setField("notes", e.target.value)} />
                    </label>
                  </div>
                )}
              />
            )}
          />

          {!isOrg && (
            <EditableSection
              title="Furlough"
              onSaved={reload}
              onSave={(d) =>
                save({
                  furloughs: d.furloughs
                    .filter((f) => f.startDate)
                    .map((f) => ({
                      startDate: f.startDate,
                      endDate: f.endDate || null,
                      notes: f.notes || null,
                    })),
                })
              }
              value={{
                furloughs: (p.furloughs || []).map((f) => ({
                  startDate: toDateInputValue(f.startDate),
                  endDate: toDateInputValue(f.endDate),
                  notes: f.notes || "",
                })),
              }}
              view={() =>
                p.furloughs?.length ? (
                  <>
                    {furloughsLoadMore.visible.map((f) => (
                      <div key={f.id} className="repeatable-row">
                        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                          <Field label="Start Date" value={formatDateLong(f.startDate)} showEmpty />
                          <Field
                            label="End Date"
                            value={f.endDate ? formatDateLong(f.endDate) : "Ongoing"}
                            showEmpty
                          />
                          <Field label="Notes" value={f.notes} />
                        </div>
                      </div>
                    ))}
                    <LoadMoreButton
                      hasMore={furloughsLoadMore.hasMore}
                      remaining={furloughsLoadMore.remaining}
                      onClick={furloughsLoadMore.showMore}
                      size="small"
                    />
                  </>
                ) : (
                  <p style={{ color: "#888" }}>No furlough history on file.</p>
                )
              }
              edit={(d, set) => (
                <RepeatableRows
                  rows={d.furloughs}
                  onChange={(rows) => set("furloughs", rows)}
                  blank={{ startDate: "", endDate: "", notes: "" }}
                  render={(row, setField) => (
                    <div className="form-grid">
                      <label>
                        Start Date
                        <input
                          type="date"
                          value={row.startDate || ""}
                          onChange={(e) => setField("startDate", e.target.value)}
                        />
                      </label>
                      <label title="Leave blank for an ongoing furlough with no settled return date.">
                        End Date
                        <input
                          type="date"
                          value={row.endDate || ""}
                          onChange={(e) => setField("endDate", e.target.value)}
                        />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Notes
                        <input value={row.notes || ""} onChange={(e) => setField("notes", e.target.value)} />
                      </label>
                    </div>
                  )}
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
