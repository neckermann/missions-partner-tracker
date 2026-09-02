import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchAdminMissionary } from "../api/client.js";
import CountryStats from "../components/CountryStats.jsx";
import NewsletterSection from "../components/admin/NewsletterSection.jsx";
import PhotoHistorySection from "../components/admin/PhotoHistorySection.jsx";
import { useSettings } from "../context/SettingsContext.jsx";

// Date-only fields are stored as UTC midnight (e.g. "1979-05-04T00:00:00.000Z").
// Parsing that with `new Date(isoString)` and formatting with toLocaleDateString
// re-interprets it in the browser's local timezone, shifting it back a day for
// anyone west of UTC. Building the Date from the raw Y/M/D components instead
// keeps it a plain calendar date with no timezone conversion — matching how
// the edit form's date inputs already treat these values.
function formatDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Renders a labeled value. By default, hides itself entirely when there's no
// value — keeps free-form sections (overview text, per-adult phone numbers,
// etc.) free of empty "Field: —" clutter. Pass `showEmpty` for fields that
// are always present as inputs on the edit form (e.g. Core Info), so the
// view mirrors the edit form's fixed field set instead of silently hiding
// entries someone might expect to see and fill in.
function Field({ label, value, showEmpty = false }) {
  const isEmpty = value === null || value === undefined || value === "";
  if (isEmpty && !showEmpty) return null;
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={isEmpty ? { color: "#aaa" } : undefined}>{isEmpty ? "—" : value}</div>
    </div>
  );
}

function formatCurrency(amount) {
  if (amount == null) return null;
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// supportEntries/needRequests are admin-only data (never sent to the public
// site — see toPublicMissionary/toPublicOrganization in backend/src/utils/maskData.js).
// Duplicated (not imported) into AdminOrganizationDetail.jsx, matching this
// codebase's existing convention for small per-page helper components.
function FinancialSupportSection({ supportEntries, needRequests }) {
  // The API already orders both by date descending, so the first entry is
  // "current" by definition.
  const current = supportEntries?.[0];

  return (
    <>
      <div className="admin-section">
        <h3>Financial Support</h3>
        <div style={{ marginBottom: "1rem" }}>
          <Field label="Current Monthly Support" value={formatCurrency(current?.amount)} showEmpty />
        </div>
        {supportEntries?.length > 0 ? (
          supportEntries.map((entry) => (
            <div key={entry.id} className="repeatable-row">
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                <Field label="Amount" value={formatCurrency(entry.amount)} />
                <Field label="Effective Date" value={formatDate(entry.effectiveDate)} />
                <Field label="Notes" value={entry.notes} />
              </div>
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No support history on file.</p>
        )}
      </div>

      <div className="admin-section">
        <h3>One-Time Needs</h3>
        {needRequests?.length > 0 ? (
          needRequests.map((need) => {
            const decided = need.approvedAmount != null;
            return (
              <div key={need.id} className="repeatable-row">
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  <span className={`status-pill ${decided ? "good" : "warn"}`}>
                    {decided
                      ? need.approvedAmount === 0
                        ? "Declined"
                        : need.approvedAmount < need.requestedAmount
                        ? "Partially Funded"
                        : "Fully Funded"
                      : "Pending Decision"}
                  </span>
                </div>
                <Field label="Description" value={need.description} showEmpty />
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                  <Field label="Requested Amount" value={formatCurrency(need.requestedAmount)} showEmpty />
                  <Field label="Request Date" value={formatDate(need.requestDate)} showEmpty />
                  <Field label="Approved Amount" value={formatCurrency(need.approvedAmount)} />
                  <Field label="Approved Date" value={formatDate(need.approvedDate)} />
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <Field label="Notes" value={need.notes} />
                </div>
              </div>
            );
          })
        ) : (
          <p style={{ color: "#888" }}>No needs on file.</p>
        )}
      </div>
    </>
  );
}

function AddressSummary({ address }) {
  // No Address row at all (never saved) should look the same as one that
  // exists but is empty — both just mean "nothing on file yet".
  const a = address || {};
  const lines = [a.addressLine1, a.addressLine2].filter(Boolean);
  const cityLine = [a.city, a.stateProvinceRegion, a.postalCode].filter(Boolean).join(", ");
  const hasAnything = lines.length || cityLine || a.country;
  if (!hasAnything) return <p style={{ color: "#888" }}>Not on file.</p>;

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

export default function AdminMissionaryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [m, setM] = useState(null);
  const { churchName } = useSettings();

  function reload() {
    return fetchAdminMissionary(id).then(setM);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!m) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const physical = (m.addresses || []).find((a) => a.type === "physical");
  const mailing = (m.addresses || []).find((a) => a.type === "mailing");
  const social = { facebook: m.facebook, twitter: m.twitter, instagram: m.instagram, linkedin: m.linkedin };
  const hasSocial = Object.values(social).some(Boolean);

  // A furlough with no end date yet, or one that hasn't ended as of today,
  // counts as "currently on furlough" for the status pill below.
  const today = new Date().toISOString().slice(0, 10);
  const activeFurlough = (m.furloughs || []).find((f) => {
    const start = String(f.startDate).slice(0, 10);
    const end = f.endDate ? String(f.endDate).slice(0, 10) : null;
    return start <= today && (!end || end >= today);
  });

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2>{m.displayName}</h2>
        <div>
          <Link to={`/admin/missionaries/${id}/edit`} className="btn" style={{ marginRight: "0.5rem" }}>
            Edit
          </Link>
          <button type="button" className="btn secondary" onClick={() => navigate("/admin/partners")}>
            Back to list
          </button>
        </div>
      </div>

      <div className="admin-form">
        <PhotoHistorySection missionaryId={m.id} photos={m.photos} onChange={reload} />

        <div className="admin-section">
          <h3>Core Info</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <Field label="Field / Region" value={m.fieldDisplayName} showEmpty />
            <Field label="Supporting Since" value={formatDate(m.supportingSince)} showEmpty />
            <Field label="Preferred Contact Method" value={m.preferredContactMethod} showEmpty />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
            <span className={`status-pill ${m.contactSafe ? "good" : "warn"}`}>
              {m.contactSafe ? "Safe to contact" : "Not safe to contact"}
            </span>
            <span className="status-pill">{m.isPublic ? "Shown on public site" : "Not public"}</span>
            {m.isRestricted && <span className="status-pill warn">Restricted-access</span>}
            {m.sentByOurChurch && <span className="status-pill good">Sent by {churchName || "our church"}</span>}
            {activeFurlough && <span className="status-pill warn">On Furlough</span>}
            {m.archived && <span className="status-pill warn">Archived {formatDate(m.archivedAt)}</span>}
          </div>
        </div>

        <FinancialSupportSection supportEntries={m.supportEntries} needRequests={m.needRequests} />

        <NewsletterSection missionaryId={m.id} newsletters={m.newsletters} onChange={reload} />

        {(m.overview || m.overviewShort || m.focusArea) && (
          <div className="admin-section">
            <h3>Ministry Overview</h3>
            <Field label="Short Overview" value={m.overviewShort} />
            <Field label="Full Overview" value={m.overview} />
            <Field label="Ministry Focus" value={m.focusArea} />
          </div>
        )}

        <div className="admin-section">
          <h3>Serving Location</h3>
          <AddressSummary address={physical} />
          <div style={{ marginTop: "0.75rem" }}>
            <Field label="Country Code" value={m.fipsCountryCode} showEmpty />
          </div>
          {m.fipsCountryCode && (
            <div style={{ marginTop: "0.75rem" }}>
              <CountryStats countryCode={m.fipsCountryCode} />
            </div>
          )}
        </div>

        <div className="admin-section">
          <h3>Mailing &amp; Contact Address</h3>
          <AddressSummary address={mailing} />
        </div>

        <div className="admin-section">
          <h3>Family</h3>
          <div style={{ marginBottom: "1rem" }}>
            <Field label="Wedding Anniversary" value={formatDate(m.anniversary)} showEmpty />
          </div>
          {m.adults?.length > 0 &&
            m.adults.map((a) => (
              <div key={a.id} className="repeatable-row">
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <Field label="Name" value={a.name} />
                  <Field label="Birthday" value={formatDate(a.birthday)} />
                  <Field label="Phone 1" value={a.phone1} />
                  <Field label="Phone 2" value={a.phone2} />
                  <Field label="Email" value={a.email} />
                </div>
              </div>
            ))}
          {m.children?.map((c) => (
            <div key={c.id} className="repeatable-row">
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <span className="status-pill">Child</span>
                <Field label="Name" value={c.name} />
                <Field label="Birthday" value={formatDate(c.birthday)} />
              </div>
            </div>
          ))}
          {!m.adults?.length && !m.children?.length && <p style={{ color: "#888" }}>None on file.</p>}
        </div>

        {(m.emergencyContact?.name || m.emergencyContact?.phone || m.emergencyContact?.email) && (
          <div className="admin-section">
            <h3>Emergency Contact</h3>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <Field label="Name" value={m.emergencyContact.name} />
              <Field label="Phone" value={m.emergencyContact.phone} />
              <Field label="Email" value={m.emergencyContact.email} />
            </div>
          </div>
        )}

        {m.languagesSpoken?.length > 0 && (
          <div className="admin-section">
            <h3>Languages Spoken</h3>
            <p>{m.languagesSpoken.join(", ")}</p>
          </div>
        )}

        <div className="admin-section">
          <h3>Trip Capacity</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <Field
              label="Team Size"
              value={
                m.tripTeamSizeMin != null || m.tripTeamSizeMax != null
                  ? `${m.tripTeamSizeMin ?? "?"} – ${m.tripTeamSizeMax ?? "?"}`
                  : null
              }
              showEmpty
            />
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <Field
              label="Trip Types Supported"
              value={m.tripTypesSupported?.length ? m.tripTypesSupported.join(", ") : null}
              showEmpty
            />
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <Field label="Best Time of Year / Duration Notes" value={m.tripSeasonNotes} />
            <Field label="Lodging & Logistics Notes" value={m.tripLogisticsNotes} />
          </div>
        </div>

        <div className="admin-section">
          <h3>Trip History</h3>
          {m.missionTrips?.length > 0 ? (
            m.missionTrips
              .slice()
              .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))
              .map((trip) => (
                <div key={trip.id} className="repeatable-row">
                  <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                    <Field
                      label="Dates"
                      value={
                        trip.startDate || trip.endDate
                          ? `${formatDate(trip.startDate) || "?"} – ${formatDate(trip.endDate) || "?"}`
                          : null
                      }
                    />
                    <Field label="Trip Type" value={trip.tripType} />
                  </div>
                  <div style={{ marginTop: "0.5rem" }}>
                    <Field label="Description" value={trip.description} />
                    <Field label="Notes" value={trip.notes} />
                  </div>
                  {trip.participants?.length > 0 && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "0.4rem" }}>
                        Participants
                      </div>
                      {trip.participants.map((p) => (
                        <div key={p.id} style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                          <Field label="Name" value={`${p.name}${p.isLeader ? " (Leader)" : ""}`} />
                          <Field label="Role" value={p.role} />
                          <Field label="Phone" value={p.phone} />
                          <Field label="Email" value={p.email} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
          ) : (
            <p style={{ color: "#888" }}>No trips on file.</p>
          )}
        </div>

        <div className="admin-section">
          <h3>Furlough</h3>
          {m.furloughs?.length > 0 ? (
            m.furloughs.map((f) => (
              <div key={f.id} className="repeatable-row">
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <Field label="Start Date" value={formatDate(f.startDate)} showEmpty />
                  <Field label="End Date" value={f.endDate ? formatDate(f.endDate) : "Ongoing"} showEmpty />
                  <Field label="Notes" value={f.notes} />
                </div>
              </div>
            ))
          ) : (
            <p style={{ color: "#888" }}>No furlough history on file.</p>
          )}
        </div>

        <div className="admin-section">
          <h3>Church Visits</h3>
          <div style={{ marginBottom: "1rem" }}>
            <Field label="Last Visit" value={m.churchVisits?.[0] ? formatDate(m.churchVisits[0].visitDate) : null} showEmpty />
          </div>
          {m.churchVisits?.length > 0 ? (
            m.churchVisits.map((v) => (
              <div key={v.id} className="repeatable-row">
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <Field label="Visit Date" value={formatDate(v.visitDate)} showEmpty />
                  <Field label="Notes" value={v.notes} />
                </div>
              </div>
            ))
          ) : (
            <p style={{ color: "#888" }}>No visits on file.</p>
          )}
        </div>

        {m.sendingChurch?.name && (
          <div className="admin-section">
            <h3>Sending Church</h3>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <Field label="Name" value={m.sendingChurch.name} />
              <Field label="Contact" value={m.sendingChurch.contactName} />
              <Field label="Contact Email" value={m.sendingChurch.contactEmail} />
              <Field label="Phone" value={m.sendingChurch.phone} />
              <Field
                label="Website"
                value={
                  m.sendingChurch.websiteLink ? (
                    <a href={m.sendingChurch.websiteLink} target="_blank" rel="noreferrer">
                      {m.sendingChurch.websiteLink}
                    </a>
                  ) : null
                }
              />
            </div>
            <AddressSummary address={m.sendingChurch.mailingAddress} />
          </div>
        )}

        {m.sendingOrg?.name && (
          <div className="admin-section">
            <h3>Sending Org</h3>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <Field label="Name" value={m.sendingOrg.name} />
              <Field label="Contact" value={m.sendingOrg.contactName} />
              <Field label="Contact Email" value={m.sendingOrg.contactEmail} />
              <Field label="Phone" value={m.sendingOrg.phone} />
              <Field
                label="Website"
                value={
                  m.sendingOrg.websiteLink ? (
                    <a href={m.sendingOrg.websiteLink} target="_blank" rel="noreferrer">
                      {m.sendingOrg.websiteLink}
                    </a>
                  ) : null
                }
              />
            </div>
            <AddressSummary address={m.sendingOrg.mailingAddress} />
          </div>
        )}

        {(m.websiteLink || m.supportLink || m.newsletterSignup || hasSocial) && (
          <div className="admin-section">
            <h3>Links &amp; Social Media</h3>
            {m.websiteLink && (
              <p>
                <a href={m.websiteLink} target="_blank" rel="noreferrer">
                  {m.websiteLink}
                </a>
              </p>
            )}
            {m.supportLink && (
              <p>
                Support: <a href={m.supportLink} target="_blank" rel="noreferrer">{m.supportLink}</a>
              </p>
            )}
            {m.newsletterSignup && (
              <p>
                Newsletter: <a href={m.newsletterSignup} target="_blank" rel="noreferrer">{m.newsletterSignup}</a>
              </p>
            )}
            {hasSocial && (
              <p>
                {Object.entries(social)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
