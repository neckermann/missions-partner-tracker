import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchAdminMissionaries,
  archiveMissionary,
  unarchiveMissionary,
  deleteMissionary,
  fetchAdminOrganizations,
  archiveOrganization,
  unarchiveOrganization,
  deleteOrganization,
} from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getContinent } from "../utils/countryContinents.js";
import { matchesSearch } from "../utils/search.js";

// Same resolution order as backend/src/utils/maskData.js's public country
// field: the physical address's country, falling back to the FIPS code if
// that's blank -- so "which country is this partner in" means the same
// thing here as it does on the public site/map.
function resolveCountry(record) {
  const physical = (record.addresses || []).find((a) => a.type === "physical");
  return physical?.country || record.fipsCountryCode || null;
}

// The API orders supportEntries by effectiveDate descending, so the first
// entry (if any) is always the current amount.
function currentSupport(supportEntries) {
  const amount = supportEntries?.[0]?.amount;
  if (amount == null) return "—";
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// The API orders churchVisits by visitDate descending, so the first entry
// (if any) is the last visit. Date-only fields are stored as UTC midnight —
// build the Date from raw Y/M/D components (not new Date(isoString)) to
// avoid a timezone-shift off-by-one-day bug, matching the detail pages.
function lastVisit(churchVisits) {
  const value = churchVisits?.[0]?.visitDate;
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

// Missionaries and organizations used to have separate list pages, each
// with its own nav link — once a church sets a shared partner term (see
// Church Settings), those two links end up reading identically, which
// looks like a bug rather than a feature. Combining into one browsable
// list (mirroring the public directory's combined-list-with-type-filter
// pattern) fixes that, while create/edit/detail stay on their own
// type-specific pages, since the underlying data really is different.
export default function AdminPartners() {
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all"); // all | missionary | organization
  const [publicFilter, setPublicFilter] = useState("all"); // all | public | notPublic
  const [restrictedFilter, setRestrictedFilter] = useState("all"); // all | restricted | notRestricted
  const [continentFilter, setContinentFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { partnerTermPlural, usePartnerTermInAdmin, churchName } = useSettings();
  const sentByLabel = `Sent by ${churchName || "Us"}`;
  const sectionTitle = usePartnerTermInAdmin ? partnerTermPlural : "Partners";

  function reload() {
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }

  useEffect(reload, []);

  // Structural type labels (which underlying record this is) are kept
  // literal regardless of the custom partner term — an admin still needs
  // to tell a missionary row from an organization row to know which form
  // to edit it on, same reasoning as the type filter below.
  const rows = useMemo(() => {
    const fromMissionaries = missionaries.map((m) => ({
      type: "missionary",
      id: m.id,
      name: m.displayName,
      typeLabel: "Missionary",
      field: m.fieldDisplayName,
      photo: m.photos?.[0]?.url,
      isPublic: m.isPublic,
      isRestricted: m.isRestricted,
      archived: m.archived,
      sentByOurChurch: m.sentByOurChurch,
      supportEntries: m.supportEntries,
      churchVisits: m.churchVisits,
      focusArea: m.focusArea,
      overview: m.overview,
      sendingChurchName: m.sendingChurch?.name,
      sendingOrgName: m.sendingOrg?.name,
      country: resolveCountry(m),
      continent: getContinent(resolveCountry(m)),
      detailLink: `/admin/missionaries/${m.id}`,
      editLink: `/admin/missionaries/${m.id}/edit`,
    }));
    const fromOrgs = organizations.map((o) => ({
      type: "organization",
      id: o.id,
      name: o.name,
      typeLabel: `${o.orgType} Org`,
      field: o.fieldDisplayName,
      photo: o.photos?.[0]?.url,
      isPublic: o.isPublic,
      isRestricted: o.isRestricted,
      archived: o.archived,
      sentByOurChurch: null,
      supportEntries: o.supportEntries,
      churchVisits: o.churchVisits,
      focusArea: o.focusArea,
      overview: o.overview,
      sendingChurchName: null, // organizations have no sendingChurch/sendingOrg relation
      sendingOrgName: null,
      country: resolveCountry(o),
      continent: getContinent(resolveCountry(o)),
      detailLink: `/admin/organizations/${o.id}`,
      editLink: `/admin/organizations/${o.id}/edit`,
    }));
    return [...fromMissionaries, ...fromOrgs].sort((a, b) => a.name.localeCompare(b.name));
  }, [missionaries, organizations]);

  const archivedCount = rows.filter((r) => r.archived).length;

  // Built from what's actually on file, not the full world list -- same
  // reasoning as the public directory's filters. Country options narrow to
  // the selected continent, if any.
  const availableContinents = useMemo(
    () => [...new Set(rows.map((r) => r.continent).filter(Boolean))].sort(),
    [rows]
  );
  const availableCountries = useMemo(
    () =>
      [...new Set(
        rows
          .filter((r) => continentFilter === "all" || r.continent === continentFilter)
          .map((r) => r.country)
          .filter(Boolean)
      )].sort(),
    [rows, continentFilter]
  );

  function handleContinentChange(value) {
    setContinentFilter(value);
    if (value !== "all" && countryFilter !== "all" && getContinent(countryFilter) !== value) {
      setCountryFilter("all");
    }
  }

  const visible = rows
    .filter((r) => showArchived || !r.archived)
    .filter((r) => typeFilter === "all" || r.type === typeFilter)
    .filter((r) => publicFilter === "all" || (publicFilter === "public") === r.isPublic)
    .filter((r) => restrictedFilter === "all" || (restrictedFilter === "restricted") === r.isRestricted)
    .filter((r) => continentFilter === "all" || r.continent === continentFilter)
    .filter((r) => countryFilter === "all" || r.country === countryFilter)
    .filter((r) =>
      matchesSearch(
        search,
        r.name,
        r.field,
        r.focusArea,
        r.overview,
        r.sendingChurchName,
        r.sendingOrgName,
        r.country
      )
    );

  function resetFilters() {
    setTypeFilter("all");
    setPublicFilter("all");
    setRestrictedFilter("all");
    setContinentFilter("all");
    setCountryFilter("all");
    setSearch("");
  }

  async function handleArchive(row) {
    if (!confirm(`Archive ${row.name}? This removes them from the public site and zeros out their monthly support, but keeps their full history. You can unarchive at any time.`)) return;
    await (row.type === "missionary" ? archiveMissionary(row.id) : archiveOrganization(row.id));
    reload();
  }

  async function handleUnarchive(row) {
    await (row.type === "missionary" ? unarchiveMissionary(row.id) : unarchiveOrganization(row.id));
    reload();
  }

  // Archiving is the deliberate first step — the backend rejects DELETE for
  // anything not already archived, so the UI only ever offers the button
  // once that's true. Typing "confirm" back is extra friction on top of
  // that, since this step is genuinely permanent.
  async function handleDelete(row) {
    const typed = prompt(`This permanently deletes ${row.name} and cannot be undone. Type "confirm" to proceed:`);
    if (typed?.trim().toLowerCase() !== "confirm") return;
    await (row.type === "missionary" ? deleteMissionary(row.id) : deleteOrganization(row.id));
    reload();
  }

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>{sectionTitle} ({visible.length})</h2>
        <div>
          <Link to="/admin/missionaries/new" className="btn" style={{ marginRight: "0.5rem" }}>+ Add Missionary</Link>
          <Link to="/admin/organizations/new" className="btn">+ Add Organization</Link>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search by name, field, focus, overview, or sending party..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "auto", minWidth: "220px" }}
          />
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}>
            Type
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All</option>
              <option value="missionary">Missionaries</option>
              <option value="organization">Organizations</option>
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}>
            Public
            <select value={publicFilter} onChange={(e) => setPublicFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All</option>
              <option value="public">Public only</option>
              <option value="notPublic">Not public</option>
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}>
            Restricted
            <select value={restrictedFilter} onChange={(e) => setRestrictedFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All</option>
              <option value="restricted">Restricted only</option>
              <option value="notRestricted">Not restricted</option>
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}>
            Continent
            <select value={continentFilter} onChange={(e) => handleContinentChange(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All</option>
              {availableContinents.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}>
            Country
            <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All</option>
              {availableCountries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="admin-checkbox-row">
            <label>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived ({archivedCount})
            </label>
          </div>
          <button type="button" className="btn secondary small" onClick={resetFilters}>
            Reset filters
          </button>
        </div>

        <table className="admin-table" style={{ marginTop: "0.75rem" }}>
          <thead>
            <tr>
              <th>Photo</th>
              <th>Name</th>
              <th>Type</th>
              <th>Field</th>
              <th>Public</th>
              <th>Restricted</th>
              <th>{sentByLabel}</th>
              <th>Monthly Support</th>
              <th>Last Visit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.type}-${row.id}`}
                onClick={() => navigate(row.detailLink)}
                style={{ cursor: "pointer", opacity: row.archived ? 0.6 : 1 }}
                title="Click to view details"
              >
                <td>
                  {row.photo && (
                    <img
                      src={row.photo}
                      alt={row.name}
                      className="missionary-thumb"
                      onError={(e) => (e.target.style.display = "none")}
                    />
                  )}
                </td>
                <td>
                  {row.name}
                  {row.archived && <span className="status-pill warn" style={{ marginLeft: "0.5rem" }}>Archived</span>}
                </td>
                <td>{row.typeLabel}</td>
                <td>{row.field}</td>
                <td>{row.isPublic ? "Yes" : "No"}</td>
                <td>{row.isRestricted ? "Yes" : "No"}</td>
                <td>{row.type === "missionary" ? (row.sentByOurChurch ? "Yes" : "No") : "—"}</td>
                <td>{currentSupport(row.supportEntries)}</td>
                <td>{lastVisit(row.churchVisits)}</td>
                <td className="table-actions" onClick={(e) => e.stopPropagation()}>
                  <Link to={row.editLink}>Edit</Link>
                  {row.archived ? (
                    <>
                      <button className="btn secondary small" onClick={() => handleUnarchive(row)}>
                        Unarchive
                      </button>
                      <button className="btn danger small" onClick={() => handleDelete(row)}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <button className="btn secondary small" onClick={() => handleArchive(row)}>
                      Archive
                    </button>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
