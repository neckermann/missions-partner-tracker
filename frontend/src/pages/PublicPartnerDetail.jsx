import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPublicPartner } from "../api/client.js";
import CountryStats from "../components/CountryStats.jsx";
import PublicSubscribeForm from "../components/PublicSubscribeForm.jsx";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import { formatYear } from "../utils/format.js";
import PhotoTile from "../components/shared/PhotoTile.jsx";

// Restricted partners simply won't have most of these keys in the API
// response at all (see toPublicPartner in maskData.js), so the
// conditional rendering below already degrades correctly with no
// type-specific handling needed.
// newsletterSignup deliberately isn't here -- it gets its own prominent
// widget further down the page instead of blending into this generic row.
const LINK_FIELDS = [
  ["websiteLink", "Website"],
  ["supportLink", "Support / Donate"],
  ["facebook", "Facebook"],
  ["twitter", "Twitter"],
  ["instagram", "Instagram"],
  ["linkedin", "LinkedIn"],
];

export default function PublicPartnerDetail() {
  const { id } = useParams();
  const { partnerTermPlural, enabledFeatures } = useSettings();
  const [partner, setPartner] = useState(null);
  const [notFound, setNotFound] = useState(false);

  // One endpoint for both kinds — the record says which it is, so the URL
  // no longer needs to carry that (the old /partners/:type/:id shape
  // redirects; see main.jsx).
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
        partner.supportingSince && `Supporting since ${formatYear(partner.supportingSince)}`,
      ]
        .filter(Boolean)
        .join(" · ");
  const links = LINK_FIELDS.filter(([key]) => partner[key]);
  const hasSendingParty = !isOrg && (partner.sendingChurch?.name || partner.sendingOrg?.name);

  return (
    <div>
      <PublicSiteHeader title={`Our ${partnerTermPlural}`} />
      <div className="admin-shell">
        <Link to="/">&larr; Back to directory</Link>

        <div className="partner-detail-header" style={{ marginTop: "1rem" }}>
          {partner.photo ? (
            // Restricted partners get a generic silhouette here (see
            // maskData.js), not a real photo -- "view full size" makes no
            // sense for a generic icon, so only non-restricted photos are
            // wrapped as a link.
            partner.isRestricted ? (
              <PhotoTile src={partner.photo} alt={name} shape="circle" size={160} className="partner-detail-photo" />
            ) : (
              <a href={partner.photo} target="_blank" rel="noreferrer">
                <PhotoTile src={partner.photo} alt={name} shape="circle" size={160} className="partner-detail-photo" />
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
              <a
                key={key}
                href={partner[key]}
                target="_blank"
                rel="noreferrer"
                className="btn secondary small"
              >
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

        {enabledFeatures.joshuaProject && partner.fipsCountryCode && (
          <div style={{ marginTop: "1.5rem" }}>
            <CountryStats countryCode={partner.fipsCountryCode} />
          </div>
        )}

        {partner.newsletterSignup && (
          // Its own widget, shown regardless of the publicPrayerDigest
          // toggle below -- this is {name}'s own external newsletter,
          // unrelated to this site's prayer-digest subscription feature,
          // so it shouldn't disappear just because that feature is off.
          // Previously folded into the prayer-digest widget's description
          // text, invisible whenever that feature was disabled.
          <div className="admin-section" style={{ marginTop: "1.5rem" }}>
            <h3 style={{ marginTop: 0 }}>{name}&rsquo;s Newsletter</h3>
            <p style={{ color: "#555" }}>
              Hear directly from {name} with their own newsletter updates.
            </p>
            <a href={partner.newsletterSignup} target="_blank" rel="noopener noreferrer" className="btn secondary">
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
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#555" }}>
              Want to pray for more than just {name}?{" "}
              <Link to="/subscribe">Pray for all of our {partnerTermPlural}, or pick several</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
