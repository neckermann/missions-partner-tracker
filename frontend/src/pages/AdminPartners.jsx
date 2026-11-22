import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchPartners, archivePartner, unarchivePartner, deletePartner } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getContinent } from "../utils/countryContinents.js";
import { matchesSearch } from "../utils/search.js";
import { formatDate } from "../utils/format.js";
import { addressByType } from "../utils/addresses.js";
import { PARTNER_TYPE_FILTER_FIELD, INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD } from "../utils/partnerEntity.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";

// Same field as backend/src/utils/maskData.js's public `country` -- the
// physical address's country, nothing else. fipsCountryCode is for Joshua
// Project lookups only, deliberately not a fallback here either, so "which
// country is this partner in" means the same thing here as it does on the
// public site/map.
function resolveCountry(record) {
  const physical = addressByType(record.addresses, "physical");
  return physical?.country || null;
}

// The API orders churchVisits by visitDate descending, so the first entry
// (if any) is the last visit.
function lastVisit(churchVisits) {
  return formatDate(churchVisits?.[0]?.visitDate, { fallback: "—" });
}

function lastVisitTimestamp(row) {
  const d = row.churchVisits?.[0]?.visitDate;
  return d ? new Date(d).getTime() : null;
}

// "Never visited" deliberately matches the quick bucket's low end
// ("Never visited" itself) but not "Within.../Over..." -- those ask about
// a real last-visit date, and a partner with none hasn't earned a bucket
// either way.
function matchesLastVisitQuick(row, quick) {
  if (quick === "all") return true;
  const ts = lastVisitTimestamp(row);
  if (quick === "never") return ts === null;
  if (ts === null) return false;
  const days = (Date.now() - ts) / 86400000;
  if (quick === "within1y") return days <= 365;
  if (quick === "over1y") return days > 365;
  if (quick === "over2y") return days > 730;
  if (quick === "over3y") return days > 1095;
  return true;
}

const emptyFilters = {
  entityType: "all",
  isPublic: "all",
  restricted: "all",
  continent: "all",
  country: "all",
  includeArchived: false,
  lastVisitQuick: "all",
  search: "",
};

// Missionaries and organizations share one list page and nav link --
// once a church sets a shared partner term (see Church Settings), two
// separate links reading identically would look like a bug.
//
// type/public/restricted/continent/country are real backend query params
// (GET /api/partners); `archived` is server-side filterable too. Free-text
// search stays client-side against the already-filtered result set
// (matchesSearch over name/field/focus/summary/country) -- debouncing a
// server round-trip per keystroke isn't worth it for a dataset this size.
// Last Visit's quick-bucket select is client-side too, for the same
// reason: it reads churchVisits[0] off a row already fetched for the
// Last Visit column and its sort, so there's no new request to make it
// server-side for.
export default function AdminPartners() {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  // Unfiltered, fetched once -- only used to build the continent/country
  // <select> option lists from what's actually on file, since the main
  // `partners` state above is a server-filtered subset and can't be used
  // for that without the options shrinking/disappearing as a filter narrows.
  const [allForOptions, setAllForOptions] = useState([]);
  const navigate = useNavigate();
  const { partnerTermPlural, usePartnerTermInAdmin } = useSettings();
  const sectionTitle = usePartnerTermInAdmin ? partnerTermPlural : "Partners";

  useEffect(() => {
    fetchPartners().then(setAllForOptions).catch(console.error);
  }, []);

  const availableContinents = useMemo(
    () => [...new Set(allForOptions.map((p) => getContinent(resolveCountry(p))).filter(Boolean))].sort(),
    [allForOptions]
  );

  const fields = useMemo(
    () => [
      PARTNER_TYPE_FILTER_FIELD,
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
        options: [
          { value: "all", label: "All" },
          ...availableContinents.map((c) => ({ value: c, label: c })),
        ],
      },
      // `options` here is a placeholder -- useFilterState only ever reads
      // `name`/`type` off a field (see its own comment), so this is safe to
      // pass to it before `availableCountries` (below, which itself depends
      // on `filters.continent`) exists. The real options get merged in for
      // FilterBar specifically, in `fieldsWithCountryOptions`.
      { name: "country", label: "Country", type: "select", options: [] },
      INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD,
      {
        name: "lastVisitQuick",
        label: "Last Visit",
        type: "select",
        options: [
          { value: "all", label: "Any time" },
          { value: "never", label: "Never visited" },
          { value: "within1y", label: "Within 1 year" },
          { value: "over1y", label: "Over 1 year ago" },
          { value: "over2y", label: "Over 2 years ago" },
          { value: "over3y", label: "Over 3 years ago" },
        ],
      },
      { name: "search", label: "Search by name, field, focus, or summary" },
    ],
    [availableContinents]
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);

  function reload() {
    setLoading(true);
    const params = {};
    if (filters.entityType !== "all") params.kind = filters.entityType;
    if (filters.isPublic !== "all") params.isPublic = filters.isPublic;
    if (filters.restricted !== "all") params.restricted = filters.restricted;
    if (filters.continent !== "all") params.continent = filters.continent;
    if (filters.country !== "all" && filters.country) params.country = filters.country;
    if (filters.includeArchived) params.archived = "true";
    fetchPartners(params)
      .then(setPartners)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [
    filters.entityType,
    filters.isPublic,
    filters.restricted,
    filters.continent,
    filters.country,
    filters.includeArchived,
  ]);

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
  // non-archived rows -- filters.includeArchived both drives the request (so
  // the archived param narrows server-side when checked) and, since the
  // unchecked default omits the param entirely (both), still needs a
  // client-side pass to hide them from the default view.
  const visibleBeforeSearch = filters.includeArchived ? rows : rows.filter((r) => !r.archived);
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
  const fieldsWithCountryOptions = useMemo(
    () =>
      fields.map((f) =>
        f.name === "country"
          ? { ...f, options: [{ value: "all", label: "All" }, ...availableCountries.map((c) => ({ value: c, label: c }))] }
          : f
      ),
    [fields, availableCountries]
  );
  // Switching continent can leave a previously-chosen country no longer in
  // range (e.g. "Kenya" selected, then continent changed to Asia) -- a
  // native <select> just silently shows nothing selected in that case
  // while the stale value keeps filtering the request, so reset it
  // explicitly instead of leaving that mismatch.
  useEffect(() => {
    if (filters.country !== "all" && !availableCountries.includes(filters.country)) {
      updateFilter("country", "all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCountries]);
  const visible = visibleBeforeSearch
    .filter((r) => matchesSearch(filters.search, r.name, r.field, r.focusArea, r.overviewShort, r.country))
    .filter((r) => matchesLastVisitQuick(r, filters.lastVisitQuick));
  const partnersLoadMore = useLoadMore(visible, { initialCount: 50, step: 50 });

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{sectionTitle}</h2>
          <p style={{ margin: "0.2rem 0 0", color: "#666" }}>
            {visible.length} active{" "}
            {visible.length === 1 ? sectionTitle.toLowerCase().replace(/s$/, "") : sectionTitle.toLowerCase()}
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <Link to="/admin/partners/new?kind=missionary" className="btn">
            + Add Missionary
          </Link>
          <Link to="/admin/partners/new?kind=organization" className="btn">
            + Add Organization
          </Link>
        </div>
      </div>

      <FilterBar fields={fieldsWithCountryOptions} values={filters} onChange={updateFilter} onReset={resetFilters} />

      <Table
        className="admin-table"
        style={{ marginTop: "0.75rem" }}
        rows={partnersLoadMore.visible}
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
            label: "Display Name",
            render: (row) => (
              <>
                <span style={{ fontWeight: 600 }}>{row.name}</span>
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
          {
            key: "isPublic",
            label: "Public",
            sortable: true,
            render: (row) =>
              row.isPublic ? (
                <StatusPill label="Yes" color="#2a5d3c" />
              ) : (
                <StatusPill label="No" color="#6b6f76" />
              ),
          },
          {
            key: "isRestricted",
            label: "Restricted",
            sortable: true,
            render: (row) =>
              row.isRestricted ? (
                <StatusPill label="Yes" color="#a6540f" />
              ) : (
                <StatusPill label="No" color="#6b6f76" />
              ),
          },
          {
            key: "sentByOurChurch",
            label: "Sent By Us",
            sortable: true,
            // Same bland, muted pill for Yes and No -- unlike Public/
            // Restricted, this isn't a safety or exposure question, just
            // bookkeeping, so neither state earns the attention a brighter
            // color would draw. Still a pill, not plain text, for visual
            // consistency with the rest of the row.
            render: (row) =>
              row.type !== "missionary" ? (
                "—"
              ) : (
                <StatusPill label={row.sentByOurChurch ? "Yes" : "No"} color="#6b6f76" />
              ),
          },
          {
            key: "churchVisits",
            label: "Last Visit",
            sortable: true,
            sortBy: (row) => {
              const d = row.churchVisits?.[0]?.visitDate;
              return d ? new Date(d).getTime() : null;
            },
            render: (row) => lastVisit(row.churchVisits),
          },
        ]}
        renderActions={(row) => (
          <>
            <Link to={row.detailLink} className="btn secondary small">
              Open
            </Link>
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
      <LoadMoreButton
        hasMore={partnersLoadMore.hasMore}
        remaining={partnersLoadMore.remaining}
        onClick={partnersLoadMore.showMore}
      />
      {confirmElement}
    </div>
  );
}
