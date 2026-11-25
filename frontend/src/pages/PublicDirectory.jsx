import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicPartners } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import { getContinent } from "../utils/countryContinents.js";
import { matchesSearch } from "../utils/search.js";
import PhotoTile from "../components/shared/PhotoTile.jsx";

// The "quick details" browse/search view; the map is for location. Both link to PublicPartnerDetail.
export default function PublicDirectory() {
  const [records, setRecords] = useState([]);
  const [typeFilter, setTypeFilter] = useState("all"); // all | missionary | organization
  const [continentFilter, setContinentFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { partnerTermPlural, publicTagline, aboutText } = useSettings();

  useEffect(() => {
    fetchPublicPartners().then(setRecords).catch(console.error);
  }, []);

  // The public API returns both kinds from one endpoint, distinguished by `kind`; reshaped for display.
  const partners = useMemo(
    () =>
      records
        .map((p) => ({
          type: p.kind,
          id: p.id,
          name: p.displayName,
          field:
            p.kind === "organization"
              ? [p.orgType, p.fieldDisplayName].filter(Boolean).join(" · ")
              : p.fieldDisplayName,
          overviewShort: p.overviewShort,
          focusArea: p.focusArea,
          // Missionary-only; the serializer omits these for organizations.
          sendingChurchName: p.sendingChurch?.name ?? null,
          sendingOrgName: p.sendingOrg?.name ?? null,
          photo: p.photo,
          isRestricted: p.isRestricted,
          country: p.country,
          continent: getContinent(p.country),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [records]
  );

  const loaded = records.length > 0;

  // Options come from the data actually present, not the full world list; countries narrow to the selected continent.
  const availableContinents = useMemo(
    () => [...new Set(partners.map((p) => p.continent).filter(Boolean))].sort(),
    [partners]
  );
  const availableCountries = useMemo(
    () =>
      [
        ...new Set(
          partners
            .filter((p) => continentFilter === "all" || p.continent === continentFilter)
            .map((p) => p.country)
            .filter(Boolean)
        ),
      ].sort(),
    [partners, continentFilter]
  );

  function handleContinentChange(value) {
    setContinentFilter(value);
    // Drop a country selection that no longer applies to the new continent.
    if (value !== "all" && countryFilter !== "all" && getContinent(countryFilter) !== value) {
      setCountryFilter("all");
    }
  }

  const filtered = partners
    .filter((p) => typeFilter === "all" || p.type === typeFilter)
    .filter((p) => continentFilter === "all" || p.continent === continentFilter)
    .filter((p) => countryFilter === "all" || p.country === countryFilter)
    .filter((p) =>
      matchesSearch(
        search,
        p.name,
        p.field,
        p.overviewShort,
        p.focusArea,
        p.sendingChurchName,
        p.sendingOrgName,
        p.country
      )
    );

  return (
    <div>
      <PublicSiteHeader title={`Our ${partnerTermPlural}`} subtitle={publicTagline} />

      <DemoBanner />
      {aboutText && <p className="public-about-text">{aboutText}</p>}

      <div className="partner-filter-bar">
        <select
          aria-label="Filter by partner type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All Partners</option>
          <option value="missionary">Missionaries</option>
          <option value="organization">Organizations</option>
        </select>
        <select
          aria-label="Filter by continent"
          value={continentFilter}
          onChange={(e) => handleContinentChange(e.target.value)}
        >
          <option value="all">All Continents</option>
          {availableContinents.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by country"
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
        >
          <option value="all">All Countries</option>
          {availableCountries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Search partners"
          placeholder="Search by name, region, focus, or organization..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="partner-grid">
        {filtered.map((p) => (
          <Link key={`${p.type}-${p.id}`} to={`/partners/${p.id}`} className="partner-card">
            <PhotoTile
              src={p.photo}
              alt={p.name}
              shape="rect"
              size={160}
              fluidWidth
              className="partner-card-photo"
            />
            <div className="partner-card-body">
              <h3>
                {p.name}
                {p.isRestricted && <span className="badge-restricted">Restricted</span>}
              </h3>
              {p.field && <p className="partner-card-meta">{p.field}</p>}
              {p.overviewShort && <p className="partner-card-summary">{p.overviewShort}</p>}
            </div>
          </Link>
        ))}
        {loaded && filtered.length === 0 && (
          <p style={{ padding: "1.5rem" }}>No partners match your search.</p>
        )}
        {!loaded && <p style={{ padding: "1.5rem" }}>Loading...</p>}
      </div>
    </div>
  );
}
