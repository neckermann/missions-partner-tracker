import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicMissionaries, fetchPublicOrganizations } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getContinent } from "../utils/countryContinents.js";
import { matchesSearch } from "../utils/search.js";

// Separate from the interactive map — this is the "quick details" browse/
// search view; the map stays focused on location, this page on scanning
// and comparing partners. Both link into the same PublicPartnerDetail page
// for the full write-up.
export default function PublicDirectory() {
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [typeFilter, setTypeFilter] = useState("all"); // all | missionary | organization
  const [continentFilter, setContinentFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { logo, partnerTermPlural, publicTagline, aboutText } = useSettings();

  useEffect(() => {
    fetchPublicMissionaries().then(setMissionaries).catch(console.error);
    fetchPublicOrganizations().then(setOrganizations).catch(console.error);
  }, []);

  const partners = useMemo(() => {
    const fromMissionaries = missionaries.map((m) => ({
      type: "missionary",
      id: m.id,
      name: m.displayName,
      field: m.fieldDisplayName,
      overviewShort: m.overviewShort,
      focusArea: m.focusArea,
      sendingChurchName: m.sendingChurch?.name,
      sendingOrgName: m.sendingOrg?.name,
      photo: m.photo,
      isRestricted: m.isRestricted,
      country: m.country,
      continent: getContinent(m.country),
    }));
    const fromOrgs = organizations.map((o) => ({
      type: "organization",
      id: o.id,
      name: o.name,
      field: [o.orgType, o.fieldDisplayName].filter(Boolean).join(" · "),
      overviewShort: o.overviewShort,
      focusArea: o.focusArea,
      sendingChurchName: null, // organizations have no sendingChurch/sendingOrg relation
      sendingOrgName: null,
      photo: o.photo,
      isRestricted: o.isRestricted,
      country: o.country,
      continent: getContinent(o.country),
    }));
    return [...fromMissionaries, ...fromOrgs].sort((a, b) => a.name.localeCompare(b.name));
  }, [missionaries, organizations]);

  const loaded = missionaries.length > 0 || organizations.length > 0;

  // Both lists are built from whatever's actually represented in the data
  // right now, not the full world list — a church's partners are typically
  // in a handful of countries, so showing all ~250 options would just be
  // noise. The country list narrows to the selected continent, if any.
  const availableContinents = useMemo(
    () => [...new Set(partners.map((p) => p.continent).filter(Boolean))].sort(),
    [partners]
  );
  const availableCountries = useMemo(
    () =>
      [...new Set(
        partners
          .filter((p) => continentFilter === "all" || p.continent === continentFilter)
          .map((p) => p.country)
          .filter(Boolean)
      )].sort(),
    [partners, continentFilter]
  );

  function handleContinentChange(value) {
    setContinentFilter(value);
    // Drop a country selection that no longer applies to the newly chosen
    // continent, rather than silently filtering to nothing.
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
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {logo?.url && <img src={logo.url} alt="" className="header-logo" />}
          <div>
            <h1>Our {partnerTermPlural}</h1>
            {publicTagline && <p className="header-tagline">{publicTagline}</p>}
          </div>
        </div>
        <Link to="/map" style={{ color: "white" }}>
          View Map
        </Link>
      </header>

      {aboutText && (
        <p className="public-about-text">{aboutText}</p>
      )}

      <div className="partner-filter-bar">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All Partners</option>
          <option value="missionary">Missionaries</option>
          <option value="organization">Organizations</option>
        </select>
        <select value={continentFilter} onChange={(e) => handleContinentChange(e.target.value)}>
          <option value="all">All Continents</option>
          {availableContinents.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
          <option value="all">All Countries</option>
          {availableCountries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search by name, region, focus, or organization..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="partner-grid">
        {filtered.map((p) => (
          <Link key={`${p.type}-${p.id}`} to={`/partners/${p.type}/${p.id}`} className="partner-card">
            {p.photo ? (
              <img src={p.photo} alt={p.name} className="partner-card-photo" />
            ) : (
              <div className="partner-card-photo" />
            )}
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
        {loaded && filtered.length === 0 && <p style={{ padding: "1.5rem" }}>No partners match your search.</p>}
        {!loaded && <p style={{ padding: "1.5rem" }}>Loading...</p>}
      </div>
    </div>
  );
}
