import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPublicPartner } from "../api/client.js";
import CountryStats from "../components/CountryStats.jsx";
import PublicSubscribeForm from "../components/PublicSubscribeForm.jsx";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import { formatYear } from "../utils/format.js";
import PhotoTile from "../components/shared/PhotoTile.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import { linkTypeLabel } from "../utils/linkTypes.js";

export default function PublicPartnerDetail() {
  const { id } = useParams();
  const { partnerTermPlural, enabledFeatures } = useSettings();
  const [partner, setPartner] = useState(null);
  const [notFound, setNotFound] = useState(false);

  // One endpoint for both kinds; the record says which it is.
  useEffect(() => {
    setPartner(null);
    setNotFound(false);
    fetchPublicPartner(id)
      .then(setPartner)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div>
        <PublicSiteHeader title={`Our ${partnerTermPlural}`} />
        <div className="admin-shell">
          <p>Partner not found.</p>
          <Link to="/">&larr; Back to directory</Link>
        </div>
      </div>
    );
  }

  if (!partner) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const isOrg = partner.kind === "organization";
  const name = partner.displayName;
  const meta = isOrg
    ? [partner.orgType, partner.fieldDisplayName].filter(Boolean).join(" · ")
    : [
        partner.fieldDisplayName,
        partner.supportingSince && `Partnering since ${formatYear(partner.supportingSince)}`,
      ]
        .filter(Boolean)
        .join(" · ");
  // newsletterSignup gets its own widget below. Restricted partners lack the field (see toPublicPartner in maskData.js).
  const links = (partner.links || []).filter((l) => l.type !== "newsletterSignup");
  const newsletterSignup = (partner.links || []).find((l) => l.type === "newsletterSignup")?.url;
  const hasSendingParty = !isOrg && (partner.sendingChurch?.name || partner.sendingOrg?.name);

  return (
    <div>
      <PublicSiteHeader title={`Our ${partnerTermPlural}`} />
      <div className="admin-shell">
        <Breadcrumb items={[{ label: partnerTermPlural, to: "/" }, { label: name }]} />

        <div className="partner-detail-header" style={{ marginTop: "1rem" }}>
          {partner.photo ? (
            // Restricted partners get a generic silhouette (see maskData.js); only real photos link to full size.
            partner.isRestricted ? (
              <PhotoTile
                src={partner.photo}
                alt={name}
                shape="circle"
                size={160}
                className="partner-detail-photo"
              />
            ) : (
              <a href={partner.photo} target="_blank" rel="noreferrer">
                <PhotoTile
                  src={partner.photo}
                  alt={name}
                  shape="circle"
                  size={160}
                  className="partner-detail-photo"
                />
              </a>
            )
          ) : (
            <PhotoTile src={null} shape="circle" size={160} className="partner-detail-photo" />
          )}
          <div>
            <h2 style={{ margin: "0 0 0.25rem" }}>
              {name}
              {partner.isRestricted && <span className="badge-restricted">Restricted</span>}
            </h2>
            {meta && <p style={{ color: "var(--muted)", margin: 0 }}>{meta}</p>}
          </div>
        </div>

        {partner.overview && <p style={{ marginTop: "1.5rem" }}>{partner.overview}</p>}
        {partner.focusArea && (
          <p>
            <strong>Focus:</strong> {partner.focusArea}
          </p>
        )}
        {!isOrg && partner.languages?.length > 0 && (
          <p>
            <strong>Languages:</strong> {partner.languages.map((l) => l.language).join(", ")}
          </p>
        )}

        {links.length > 0 && (
          <div className="partner-links">
            {links.map((l) => (
              <a key={l.type} href={l.url} target="_blank" rel="noreferrer" className="btn secondary small">
                {linkTypeLabel(l.type)}
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

        {enabledFeatures.joshuaProject && partner.fipsCountryCode && (
          <div style={{ marginTop: "1.5rem" }}>
            <CountryStats countryCode={partner.fipsCountryCode} />
          </div>
        )}

        {newsletterSignup && (
          // Its own widget, shown regardless of the publicPrayerDigest toggle: this is the partner's
          // external newsletter, unrelated to this site's prayer-digest feature.
          <div className="admin-section" style={{ marginTop: "1.5rem" }}>
            <h3 style={{ marginTop: 0 }}>{name}&rsquo;s Newsletter</h3>
            <p style={{ color: "var(--muted)" }}>
              Hear directly from {name} with their own newsletter updates.
            </p>
            <a href={newsletterSignup} target="_blank" rel="noopener noreferrer" className="btn secondary">
              Sign up for their newsletter
            </a>
          </div>
        )}

        {enabledFeatures.publicPrayerDigest && (
          <>
            <PublicSubscribeForm
              allPartners={false}
              partnerIds={[partner.id]}
              title={`Follow ${name}'s prayer requests`}
              description={`Get an email when there's a new or answered prayer request we've received about ${name} -- gathered from their newsletters and other updates to us.`}
            />
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "var(--muted)" }}>
              Want to pray for more than just {name}?{" "}
              <Link to="/subscribe">Pray for all of our {partnerTermPlural}, or pick several</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
