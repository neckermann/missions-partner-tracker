import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchAdminOrganization } from "../api/client.js";
import CountryStats from "../components/CountryStats.jsx";
import NewsletterSection from "../components/admin/NewsletterSection.jsx";
import PhotoHistorySection from "../components/admin/PhotoHistorySection.jsx";

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching AdminMissionaryDetail.jsx's formatDate.
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
// value; pass showEmpty for fields that are always present as inputs on the
// edit form, so the view mirrors the edit form's fixed field set.
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
// Duplicated from AdminMissionaryDetail.jsx, matching this codebase's
// existing convention for small per-page helper components.
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

export default function AdminOrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [o, setO] = useState(null);

  function reload() {
    return fetchAdminOrganization(id).then(setO);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!o) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const physical = (o.addresses || []).find((a) => a.type === "physical");
  const mailing = (o.addresses || []).find((a) => a.type === "mailing");
  const social = { facebook: o.facebook, twitter: o.twitter, instagram: o.instagram, linkedin: o.linkedin };
  const hasSocial = Object.values(social).some(Boolean);

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2>{o.name}</h2>
        <div>
          <Link to={`/admin/organizations/${id}/edit`} className="btn" style={{ marginRight: "0.5rem" }}>
            Edit
          </Link>
          <button type="button" className="btn secondary" onClick={() => navigate("/admin/partners")}>
            Back to list
          </button>
        </div>
      </div>

      <div className="admin-form">
        <PhotoHistorySection organizationId={o.id} photos={o.photos} onChange={reload} />

        <div className="admin-section">
          <h3>Core Info</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <Field label="Organization Type" value={o.orgType} showEmpty />
            <Field label="Field / Region" value={o.fieldDisplayName} showEmpty />
            <Field label="Supporting Since" value={formatDate(o.supportingSince)} showEmpty />
            <Field label="Preferred Contact Method" value={o.preferredContactMethod} showEmpty />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
            <span className="status-pill">{o.isPublic ? "Shown on public site" : "Not public"}</span>
            {o.isRestricted && <span className="status-pill warn">Restricted-access</span>}
            {o.archived && <span className="status-pill warn">Archived {formatDate(o.archivedAt)}</span>}
          </div>
        </div>

        <div className="admin-section">
          <h3>Contact Info</h3>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <Field label="Contact Name" value={o.contactName} />
            <Field label="Contact Phone" value={o.contactPhone} />
            <Field label="Contact Email" value={o.contactEmail} />
            <Field
              label="Website"
              value={
                o.websiteLink ? (
                  <a href={o.websiteLink} target="_blank" rel="noreferrer">
                    {o.websiteLink}
                  </a>
                ) : null
              }
            />
            <Field
              label="Support Link"
              value={
                o.supportLink ? (
                  <a href={o.supportLink} target="_blank" rel="noreferrer">
                    {o.supportLink}
                  </a>
                ) : null
              }
            />
            <Field
              label="Newsletter Signup"
              value={
                o.newsletterSignup ? (
                  <a href={o.newsletterSignup} target="_blank" rel="noreferrer">
                    {o.newsletterSignup}
                  </a>
                ) : null
              }
            />
          </div>
          {hasSocial && (
            <div style={{ marginTop: "0.75rem" }}>
              <Field
                label="Social Media"
                value={Object.entries(social)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              />
            </div>
          )}
        </div>

        <FinancialSupportSection supportEntries={o.supportEntries} needRequests={o.needRequests} />

        <NewsletterSection organizationId={o.id} newsletters={o.newsletters} onChange={reload} />

        {(o.overview || o.overviewShort || o.focusArea) && (
          <div className="admin-section">
            <h3>Overview</h3>
            <Field label="Short Overview" value={o.overviewShort} />
            <Field label="Full Overview" value={o.overview} />
            <Field label="Focus Area" value={o.focusArea} />
          </div>
        )}

        <div className="admin-section">
          <h3>Serving Location</h3>
          <AddressSummary address={physical} />
          <div style={{ marginTop: "0.75rem" }}>
            <Field label="Country Code" value={o.fipsCountryCode} showEmpty />
          </div>
          {o.fipsCountryCode && (
            <div style={{ marginTop: "0.75rem" }}>
              <CountryStats countryCode={o.fipsCountryCode} />
            </div>
          )}
        </div>

        <div className="admin-section">
          <h3>Mailing &amp; Contact Address</h3>
          <AddressSummary address={mailing} />
        </div>

        <div className="admin-section">
          <h3>Trip Capacity</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <Field
              label="Team Size"
              value={
                o.tripTeamSizeMin != null || o.tripTeamSizeMax != null
                  ? `${o.tripTeamSizeMin ?? "?"} – ${o.tripTeamSizeMax ?? "?"}`
                  : null
              }
              showEmpty
            />
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <Field
              label="Trip Types Supported"
              value={o.tripTypesSupported?.length ? o.tripTypesSupported.join(", ") : null}
              showEmpty
            />
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <Field label="Best Time of Year / Duration Notes" value={o.tripSeasonNotes} />
            <Field label="Lodging & Logistics Notes" value={o.tripLogisticsNotes} />
          </div>
        </div>

        <div className="admin-section">
          <h3>Trip History</h3>
          {o.orgTrips?.length > 0 ? (
            o.orgTrips
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
          <h3>Church Visits</h3>
          <div style={{ marginBottom: "1rem" }}>
            <Field label="Last Visit" value={o.churchVisits?.[0] ? formatDate(o.churchVisits[0].visitDate) : null} showEmpty />
          </div>
          {o.churchVisits?.length > 0 ? (
            o.churchVisits.map((v) => (
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
      </div>
    </div>
  );
}
