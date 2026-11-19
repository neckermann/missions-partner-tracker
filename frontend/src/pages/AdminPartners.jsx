import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchPartners, archivePartner, unarchivePartner, deletePartner } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getContinent } from "../utils/countryContinents.js";
import { matchesSearch } from "../utils/search.js";
import { formatCurrency, formatDate } from "../utils/format.js";
import { addressByType } from "../utils/addresses.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";

// Same field as backend/src/utils/maskData.js's public `country` -- the
// physical address's country, nothing else. fipsCountryCode is for Joshua
// Project lookups only, deliberately not a fallback here either, so "which
// country is this partner in" means the same thing here as it does on the
// public site/map.
function resolveCountry(record) {
  const physical = addressByType(record.addresses, "physical");
  return physical?.country || null;
}

// The API orders supportEntries by effectiveDate descending, so the first
// entry (if any) is always the current amount.
function currentSupport(supportEntries) {
  return formatCurrency(supportEntries?.[0]?.amount, { fallback: "—" });
}

// The API orders churchVisits by visitDate descending, so the first entry
// (if any) is the last visit.
function lastVisit(churchVisits) {
  return formatDate(churchVisits?.[0]?.visitDate, { fallback: "—" });
}

const emptyFilters = {
  type: "all",
  isPublic: "all",
  restricted: "all",
  continent: "all",
  country: "all",
  showArchived: false,
  search: "",
};

// Missionaries and organizations used to have separate list pages, each
// with its own nav link — once a church sets a shared partner term (see
// Church Settings), those two links end up reading identically, which
// looks like a bug rather than a feature. This page combined them in the
// UI first; they're one underlying record now too, so the merging this
// page used to do client-side is gone.
//
// Phase 1 of the UX-rebuild plan: type/public/restricted/continent/country
// are now real backend query params (GET /api/partners), proving the
// FilterBar/Table contract generalizes past Reports with an actual network
// round-trip, not just client-side array filtering -- `archived` was
// already server-side filterable, now driven by the same useFilterState
// URL sync as everything else. Free-text search stays client-side against
// the already-filtered result set (matchesSearch over name/field/focus/
// summary/country): debouncing a server round-trip per keystroke isn't
// worth it for a dataset this size, same judgment AdminTrips.jsx already
// made for several of its own filters.
export default function AdminPartners() {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  // Unfiltered, fetched once -- only used to build the continent/country
  // <select> option lists from what's actually on file (same reasoning
  // AdminPartners used before this migration), since the main `partners`
  // state above is now a server-filtered subset and can't be used for that
  // without the options shrinking/disappearing as a filter narrows them.
  const [allForOptions, setAllForOptions] = useState([]);
  const navigate = useNavigate();
  const { partnerTermPlural, usePartnerTermInAdmin, churchName } = useSettings();
  const sentByLabel = `Sent by ${churchName || "Us"}`;
  const sectionTitle = usePartnerTermInAdmin ? partnerTermPlural : "Partners";

  useEffect(() => {
    fetchPartners().then(setAllForOptions).catch(console.error);
  }, []);

  const availableContinents = useMemo(
    () =>
      [...new Set(allForOptions.map((p) => getContinent(resolveCountry(p))).filter(Boolean))].sort(),
    [allForOptions]
  );

  const fields = useMemo(
    () => [
      {
        name: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "missionary", label: "Missionaries" },
          { value: "organization", label: "Organizations" },
        ],
      },
      {
        name: "isPublic",
        label: "Public",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "true", label: "Public only" },
          { value: "false", label: "Not public" },
        ],
      },
      {
        name: "restricted",
        label: "Restricted",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "true", label: "Restricted only" },
          { value: "false", label: "Not restricted" },
        ],
      },
      {
        name: "continent",
        label: "Continent",
        type: "select",
        options: [{ value: "all", label: "All" }, ...availableContinents.map((c) => ({ value: c, label: c }))],
      },
      { name: "country", label: "Country" },
      { name: "showArchived", label: "Show archived", type: "checkbox" },
      { name: "search", label: "Search by name, field, focus, or summary" },
    ],
    [availableContinents]
  );
  const { values: filters, setValue: updateFilter, reset: resetFilters } = useFilterState(fields, emptyFilters);

  function reload() {
    setLoading(true);
    const params = {};
    if (filters.type !== "all") params.kind = filters.type;
    if (filters.isPublic !== "all") params.isPublic = filters.isPublic;
    if (filters.restricted !== "all") params.restricted = filters.restricted;
    if (filters.continent !== "all") params.continent = filters.continent;
    if (filters.country !== "all" && filters.country) params.country = filters.country;
    if (filters.showArchived) params.archived = "true";
    fetchPartners(params)
      .then(setPartners)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [filters.type, filters.isPublic, filters.restricted, filters.continent, filters.country, filters.showArchived]);

  const rows = useMemo(
    () =>
      partners
        .map((p) => ({
          type: p.kind,
          id: p.id,
          name: p.displayName,
          typeLabel: p.kind === "organization" ? `${p.orgType || "Partner"} Org` : "Missionary",
          field: p.fieldDisplayName,
          photo: p.photos?.[0]?.url,
          isPublic: p.isPublic,
          isRestricted: p.isRestricted,
          archived: p.archived,
          sentByOurChurch: p.sentByOurChurch,
          supportEntries: p.supportEntries,
          churchVisits: p.churchVisits,
          focusArea: p.focusArea,
          overviewShort: p.overviewShort,
          country: resolveCountry(p),
          detailLink: `/admin/partners/${p.id}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [partners]
  );

  // Without ?archived param, the backend already returns both archived and
  // non-archived rows -- filters.showArchived both drives the request (so
  // the archived param narrows server-side when checked) and, since the
  // unchecked default omits the param entirely (both), still needs a
  // client-side pass to hide them from the default view.
  const visibleBeforeSearch = filters.showArchived ? rows : rows.filter((r) => !r.archived);
  const availableCountries = useMemo(
    () =>
      [
        ...new Set(
          allForOptions
            .map((p) => resolveCountry(p))
            .filter((c) => c && (filters.continent === "all" || getContinent(c) === filters.continent))
        ),
      ].sort(),
    [allForOptions, filters.continent]
  );
  const visible = visibleBeforeSearch.filter((r) =>
    matchesSearch(filters.search, r.name, r.field, r.focusArea, r.overviewShort, r.country)
  );

  async function handleArchive(row) {
    const confirmed = await confirmDialog({
      title: `Archive ${row.name}?`,
      body: (
        <ConfirmMessageBody>
          This removes them from the public site and zeros out their monthly support, but keeps their full
          history. You can unarchive at any time.
        </ConfirmMessageBody>
      ),
      confirmLabel: "Archive",
      danger: true,
    });
    if (!confirmed) return;
    await archivePartner(row.id);
    reload();
  }

  async function handleUnarchive(row) {
    await unarchivePartner(row.id);
    reload();
  }

  // Archiving is the deliberate first step — the backend rejects DELETE for
  // anything not already archived, so the UI only ever offers the button
  // once that's true. Typing "confirm" back is extra friction on top of
  // that, since this step is genuinely permanent -- see useConfirmDialog's
  // own typedConfirmation option, built for exactly this one case.
  async function handleDelete(row) {
    const confirmed = await confirmDialog({
      title: `Permanently delete ${row.name}?`,
      body: (
        <ConfirmMessageBody>
          This deletes everything tied to them: their household, address, prayer requests, one-time needs,
          support history, documents and newsletters, photos, church visits, and furlough records -- plus any
          trips organized around them, including those trips&apos; own rosters, applications, and documents.
          Every admin and public subscriber following them will stop. This cannot be undone.
        </ConfirmMessageBody>
      ),
      confirmLabel: "Delete permanently",
      danger: true,
      typedConfirmation: { word: "confirm", label: 'Type "confirm" to proceed' },
    });
    if (!confirmed) return;
    await deletePartner(row.id);
    reload();
    fetchPartners().then(setAllForOptions).catch(console.error);
  }

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>
          {sectionTitle} ({visible.length})
        </h2>
        <div>
          <Link to="/admin/partners/new?kind=missionary" className="btn" style={{ marginRight: "0.5rem" }}>
            + Add Missionary
          </Link>
          <Link to="/admin/partners/new?kind=organization" className="btn">
            + Add Organization
          </Link>
        </div>
      </div>

      <FilterBar fields={fields} values={filters} onChange={updateFilter} onReset={resetFilters} />
      {filters.continent !== "all" && availableCountries.length > 0 && (
        <p style={{ fontSize: "0.8rem", color: "#888", marginTop: "0.25rem" }}>
          Countries on file in {filters.continent}: {availableCountries.join(", ")}
        </p>
      )}

      <div className="table-scroll">
        <Table
          className="admin-table"
          style={{ marginTop: "0.75rem" }}
          rows={visible}
          rowKey={(row) => `${row.type}-${row.id}`}
          onRowClick={(row) => navigate(row.detailLink)}
          emptyMessage={loading ? "Loading…" : "No partners match these filters."}
          columns={[
            {
              key: "photo",
              label: "Photo",
              render: (row) =>
                row.photo ? (
                  <img
                    src={row.photo}
                    alt={row.name}
                    className="missionary-thumb"
                    onError={(e) => (e.target.style.display = "none")}
                  />
                ) : (
                  ""
                ),
            },
            {
              key: "name",
              label: "Name",
              render: (row) => (
                <>
                  {row.name}
                  {row.archived && (
                    <span style={{ marginLeft: "0.5rem" }}>
                      <StatusPill label="Archived" color="#a6540f" />
                    </span>
                  )}
                </>
              ),
            },
            { key: "typeLabel", label: "Type" },
            { key: "field", label: "Field" },
            { key: "isPublic", label: "Public", render: (row) => (row.isPublic ? "Yes" : "No") },
            { key: "isRestricted", label: "Restricted", render: (row) => (row.isRestricted ? "Yes" : "No") },
            {
              key: "sentByOurChurch",
              label: sentByLabel,
              render: (row) => (row.type === "missionary" ? (row.sentByOurChurch ? "Yes" : "No") : "—"),
            },
            {
              key: "supportEntries",
              label: "Monthly Support",
              render: (row) => currentSupport(row.supportEntries),
            },
            { key: "churchVisits", label: "Last Visit", render: (row) => lastVisit(row.churchVisits) },
          ]}
          renderActions={(row) => (
            <>
              <Link to={row.detailLink}>Open</Link>
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
            </>
          )}
        />
      </div>
      {confirmElement}
    </div>
  );
}
