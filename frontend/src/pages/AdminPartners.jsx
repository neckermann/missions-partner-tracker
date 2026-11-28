import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/shared/PageHeader.jsx";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchPartners, archivePartner, unarchivePartner, deletePartner } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { publicSiteOn } from "../utils/publicSite.js";
import { getContinent } from "../utils/countryContinents.js";
import { matchesSearch } from "../utils/search.js";
import { formatDate } from "../utils/format.js";
import { addressByType } from "../utils/addresses.js";
import { PARTNER_TYPE_FILTER_FIELD, INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD } from "../utils/partnerEntity.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import EmptyListMessage, { filtersActive } from "../components/shared/EmptyListMessage.jsx";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import useSendingChurchField from "../hooks/useSendingChurchField.js";
import { partnersTabState } from "../utils/partnersTabs.js";
import LastUpdatedCell, { lastUpdatedSortKey } from "../components/shared/LastUpdatedCell.jsx";
import AssignedPartnersTable from "../components/admin/AssignedPartnersTable.jsx";
import TabBar from "../components/shared/TabBar.jsx";

// Same field as the public `country` in backend/src/utils/maskData.js: the physical address's
// country only. fipsCountryCode is for Joshua Project lookups, deliberately not a fallback.
function resolveCountry(record) {
  const physical = addressByType(record.addresses, "physical");
  return physical?.country || null;
}

// The API orders churchVisits by visitDate descending, so the first is the last visit.
function lastVisit(churchVisits) {
  return formatDate(churchVisits?.[0]?.visitDate, { fallback: "—" });
}

function lastVisitTimestamp(row) {
  const d = row.churchVisits?.[0]?.visitDate;
  return d ? new Date(d).getTime() : null;
}

// "Never visited" matches the quick bucket's "Never visited" but not "Within.../Over...",
// which ask about a real date.
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
  sendingChurch: "all",
  isPublic: "all",
  restricted: "all",
  continent: "all",
  country: "all",
  includeArchived: false,
  lastVisitQuick: "all",
  search: "",
};

// Missionaries and organizations share one list page and nav link.
// type/public/restricted/continent/country/archived are backend query params
// (GET /api/partners). Free-text search and the Last Visit quick bucket stay client-side:
// no per-keystroke round-trip, and the bucket reads churchVisits[0] already fetched.
// Sent by our church only applies to missionaries.
const isSentByUs = (row) => row.type === "missionary" && row.sentByOurChurch;

export default function AdminPartners() {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  // Unfiltered, fetched once, only to build the continent/country option lists; the main
  // `partners` state is a filtered subset and the options would shrink as a filter narrows.
  const [allForOptions, setAllForOptions] = useState([]);
  const navigate = useNavigate();
  const { partnerTermPlural, usePartnerTermInAdmin, enabledFeatures } = useSettings();
  const sectionTitle = usePartnerTermInAdmin ? partnerTermPlural : "Partners";
  const { canWrite, isAdmin, isGuest, careTeamSeats, onMissionsTeam } = useCurrentUser();
  // "My partners": for someone who looks after partners (holds a care team seat, or is on the missions team)
  // while the contact log is on. The notification's link lands here with ?assigned=1.
  const [searchParams, setSearchParams] = useSearchParams();
  const hasAssignedTab = !!enabledFeatures.contactLog && (careTeamSeats.length > 0 || onMissionsTeam);
  // Staff land on All; a guest gets one plain list, no tabs (see utils/partnersTabs.js).
  const { showAssigned, showTabs } = partnersTabState({
    hasAssignedTab,
    isGuest,
    assignedParam: searchParams.get("assigned"),
  });
  const setTab = (assigned) => setSearchParams(assigned ? { assigned: "1" } : {}, { replace: true });

  useEffect(() => {
    fetchPartners().then(setAllForOptions).catch(console.error);
  }, []);

  const availableContinents = useMemo(
    () => [...new Set(allForOptions.map((p) => getContinent(resolveCountry(p))).filter(Boolean))].sort(),
    [allForOptions]
  );

  const sendingChurchField = useSendingChurchField();
  const publicOn = publicSiteOn(enabledFeatures);
  const fields = useMemo(
    () => [
      PARTNER_TYPE_FILTER_FIELD,
      ...(sendingChurchField ? [sendingChurchField] : []),
      ...(publicOn
        ? [
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
          ]
        : []),
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
      // `options` is a placeholder: useFilterState only reads `name`/`type` (see its comment),
      // so this is safe before `availableCountries` exists. Real options are merged for
      // FilterBar in `fieldsWithCountryOptions`.
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
    [availableContinents, sendingChurchField, publicOn]
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
    if (filters.sendingChurch !== "all") params.sendingChurch = filters.sendingChurch;
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

  useEffect(reload, [
    filters.entityType,
    filters.sendingChurch,
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
          lastUpdatedAt: p.lastUpdatedAt,
          lastUpdatedByName: p.lastUpdatedByName,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [partners]
  );

  // Without an ?archived param the backend returns both. filters.includeArchived drives the
  // request, and the unchecked default omits the param, so it still needs a client-side pass.
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
          ? {
              ...f,
              options: [
                { value: "all", label: "All" },
                ...availableCountries.map((c) => ({ value: c, label: c })),
              ],
            }
          : f
      ),
    [fields, availableCountries]
  );
  // Changing continent can leave the chosen country out of range; a native <select> would
  // show nothing selected while the stale value kept filtering, so reset it.
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

  // Archiving is the first step: the backend rejects DELETE unless already archived. Typing
  // "confirm" adds friction since this is permanent (useConfirmDialog typedConfirmation).
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
      <PageHeader
        title={sectionTitle}
        subtitle={`${visible.length}${filters.includeArchived ? "" : " active"} ${
          visible.length === 1 ? sectionTitle.toLowerCase().replace(/s$/, "") : sectionTitle.toLowerCase()
        }${filters.includeArchived ? ", archived included" : ""}`}
        actions={
          canWrite && (
            <>
              <Link to="/admin/partners/new?kind=missionary" className="btn">
                + Add Missionary
              </Link>
              <Link to="/admin/partners/new?kind=organization" className="btn">
                + Add Organization
              </Link>
            </>
          )
        }
      />

      {showTabs && (
        <TabBar
          ariaLabel="Partner views"
          activeKey={showAssigned ? "mine" : "all"}
          tabs={[
            { key: "all", label: "All", onClick: () => setTab(false) },
            { key: "mine", label: "My partners", onClick: () => setTab(true) },
          ]}
        />
      )}

      {showAssigned ? (
        <AssignedPartnersTable />
      ) : (
        <>
          <FilterBar
            fields={fieldsWithCountryOptions}
            values={filters}
            onChange={updateFilter}
            onReset={resetFilters}
          />

          <Table
            className="admin-table"
            style={{ marginTop: "0.75rem" }}
            rows={partnersLoadMore.visible}
            rowKey={(row) => `${row.type}-${row.id}`}
            onRowClick={(row) => navigate(row.detailLink)}
            rowHref={(row) => row.detailLink}
            emptyMessage={
              loading ? (
                "Loading…"
              ) : (
                <EmptyListMessage
                  filtered={filtersActive(filters, emptyFilters)}
                  filteredText="No partners match these filters."
                  onClear={resetFilters}
                >
                  No {sectionTitle.toLowerCase()} yet. This is where the people and organizations your church
                  supports are listed, with their contact details, prayer requests and support.
                  {canWrite && (
                    <>
                      {" "}
                      <Link to="/admin/partners/new?kind=missionary" className="btn small">
                        + Add the first missionary
                      </Link>{" "}
                      <Link to="/admin/partners/new?kind=organization" className="btn secondary small">
                        + Add an organization
                      </Link>
                    </>
                  )}
                </EmptyListMessage>
              )
            }
            columns={[
              {
                key: "name",
                label: "Display Name",
                // Photo beside the name, not its own column (blank for most partners); a
                // fixed-size slot keeps names aligned.
                render: (row) => (
                  <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ width: 36, height: 36, flexShrink: 0 }}>
                      {row.photo && (
                        <img
                          src={row.photo}
                          alt={row.name}
                          loading="lazy"
                          decoding="async"
                          className="missionary-thumb"
                          style={{ width: 36, height: 36 }}
                          onError={(e) => (e.target.style.display = "none")}
                        />
                      )}
                    </span>
                    <span>
                      <span style={{ fontWeight: 600 }}>{row.name}</span>
                      {row.archived && (
                        <span style={{ marginLeft: "0.5rem" }}>
                          <StatusPill label="Archived" color="#a6540f" />
                        </span>
                      )}
                    </span>
                  </span>
                ),
              },
              { key: "typeLabel", label: "Type" },
              { key: "field", label: "Field" },
              {
                key: "flags",
                label: "Flags",
                // Only what is out of the ordinary, not three yes/no columns. Not sortable:
                // a row can carry several flags; the filters above isolate one.
                render: (row) =>
                  row.isRestricted || (publicOn && !row.isPublic) || isSentByUs(row) ? (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                      {row.isRestricted && <StatusPill label="Restricted" color="#a6540f" />}
                      {publicOn && !row.isPublic && <StatusPill label="Not public" color="#6b6f76" />}
                      {isSentByUs(row) && <StatusPill label="Sent by us" color="#6b6f76" />}
                    </span>
                  ) : (
                    "—"
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
              // When the partner, or anything on its page, was last changed (staff
              // only: a guest's list carries no editor names).
              ...(isGuest
                ? []
                : [
                    {
                      key: "lastUpdatedAt",
                      label: "Last updated",
                      sortable: true,
                      sortBy: (row) => lastUpdatedSortKey(row.lastUpdatedAt),
                      render: (row) => (
                        <LastUpdatedCell at={row.lastUpdatedAt} name={row.lastUpdatedByName} />
                      ),
                    },
                  ]),
            ]}
            renderActions={(row) => (
              <>
                {row.archived ? (
                  <>
                    {canWrite && (
                      <button className="btn secondary small" onClick={() => handleUnarchive(row)}>
                        Unarchive
                      </button>
                    )}
                    {isAdmin && (
                      <button className="btn danger small" onClick={() => handleDelete(row)}>
                        Delete
                      </button>
                    )}
                  </>
                ) : (
                  canWrite && (
                    <button className="btn secondary small" onClick={() => handleArchive(row)}>
                      Archive
                    </button>
                  )
                )}
              </>
            )}
          />
          <LoadMoreButton
            hasMore={partnersLoadMore.hasMore}
            remaining={partnersLoadMore.remaining}
            onClick={partnersLoadMore.showMore}
          />
        </>
      )}
      {confirmElement}
    </div>
  );
}
