import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPublicMissionary, fetchPublicOrganization } from "../api/client.js";
import CountryStats from "../components/CountryStats.jsx";
import { useSettings } from "../context/SettingsContext.jsx";

// supportingSince is a full date under the hood but only the year is
// meaningful to show publicly — matches PublicMap's formatYear.
function formatYear(value) {
  if (!value) return null;
  return String(value).slice(0, 4);
}

// Restricted partners simply won't have most of these keys in the API
// response at all (see toPublicMissionary/toPublicOrganization), so the
// conditional rendering below already degrades correctly with no
// type-specific handling needed.
const LINK_FIELDS = [
  ["websiteLink", "Website"],
  ["supportLink", "Support / Donate"],
  ["newsletterSignup", "Newsletter Signup"],
  ["facebook", "Facebook"],
  ["twitter", "Twitter"],
  ["instagram", "Instagram"],
  ["linkedin", "LinkedIn"],
];

function PublicHeader() {
  const { logo, partnerTermPlural } = useSettings();
  return (
    <header className="app-header">
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {logo?.url && <img src={logo.url} alt="" className="header-logo" />}
        <h1>Our {partnerTermPlural}</h1>
      </div>
      <Link to="/map" style={{ color: "white" }}>
        View Map
      </Link>
    </header>
  );
}

export default function PublicPartnerDetail() {
  const { type, id } = useParams();
  const [partner, setPartner] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setPartner(null);
    setNotFound(false);
    const fetcher = type === "organization" ? fetchPublicOrganization : fetchPublicMissionary;
    fetcher(id)
      .then(setPartner)
      .catch(() => setNotFound(true));
  }, [type, id]);

  if (notFound) {
    return (
      <div>
        <PublicHeader />
        <div className="admin-shell">
          <p>Partner not found.</p>
          <Link to="/">&larr; Back to directory</Link>
        </div>
      </div>
    );
  }

  if (!partner) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const isOrg = type === "organization";
  const name = isOrg ? partner.name : partner.displayName;
  const meta = isOrg
    ? [partner.orgType, partner.fieldDisplayName].filter(Boolean).join(" · ")
    : [partner.fieldDisplayName, partner.supportingSince && `Since ${formatYear(partner.supportingSince)}`]
        .filter(Boolean)
        .join(" · ");
  const links = LINK_FIELDS.filter(([key]) => partner[key]);
  const hasSendingParty = !isOrg && (partner.sendingChurch?.name || partner.sendingOrg?.name);

  return (
    <div>
      <PublicHeader />
      <div className="admin-shell">
        <Link to="/">&larr; Back to directory</Link>

        <div className="partner-detail-header" style={{ marginTop: "1rem" }}>
          {partner.photo ? (
            <a href={partner.photo} target="_blank" rel="noreferrer">
              <img src={partner.photo} alt={name} className="partner-detail-photo" />
            </a>
          ) : (
            <div className="partner-detail-photo" />
          )}
          <div>
            <h2 style={{ margin: "0 0 0.25rem" }}>
              {name}
              {partner.isRestricted && <span className="badge-restricted">Restricted</span>}
            </h2>
            {meta && <p style={{ color: "#666", margin: 0 }}>{meta}</p>}
          </div>
        </div>

        {partner.overview && <p style={{ marginTop: "1.5rem" }}>{partner.overview}</p>}
        {partner.focusArea && (
          <p>
            <strong>Focus:</strong> {partner.focusArea}
          </p>
        )}
        {!isOrg && partner.languagesSpoken?.length > 0 && (
          <p>
            <strong>Languages:</strong> {partner.languagesSpoken.join(", ")}
          </p>
        )}

        {links.length > 0 && (
          <div className="partner-links">
            {links.map(([key, label]) => (
              <a key={key} href={partner[key]} target="_blank" rel="noreferrer" className="btn secondary small">
                {label}
              </a>
            ))}
          </div>
        )}

        {hasSendingParty && (
          <>
            {partner.sendingChurch?.name && (
              <p>
                <strong>Sending Church:</strong> {partner.sendingChurch.name}
              </p>
            )}
            {partner.sendingOrg?.name && (
              <p>
                <strong>Sending Org:</strong> {partner.sendingOrg.name}
              </p>
            )}
          </>
        )}

        {partner.fipsCountryCode && (
          <div style={{ marginTop: "1.5rem" }}>
            <CountryStats countryCode={partner.fipsCountryCode} />
          </div>
        )}
      </div>
    </div>
  );
}
