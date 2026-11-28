import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/shared/PageHeader.jsx";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchTrips,
  fetchPartners,
  fetchTripPlanning,
  createTrip,
  updateTrip,
  deleteTrip,
  cloneTrip,
} from "../api/client.js";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import TripFormFields, {
  TRIP_TYPE_PRESETS,
  emptyTripForm,
  cleanTripParticipants,
} from "../components/admin/TripFormFields.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Modal from "../components/Modal.jsx";
import Field from "../components/admin/Field.jsx";
import { formatDate, toDateInputValue, formatCurrency } from "../utils/format.js";
import { PARTNER_TYPE_FILTER_FIELD } from "../utils/partnerEntity.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import TripStatusBadge, { STATUS_LABELS } from "../components/admin/TripStatusBadge.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import EmptyListMessage, { filtersActive } from "../components/shared/EmptyListMessage.jsx";
import PartnerFilterChip from "../components/shared/PartnerFilterChip.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";
import useSendingChurchField from "../hooks/useSendingChurchField.js";
import useCurrentUser from "../hooks/useCurrentUser.js";
import LastUpdatedCell, { lastUpdatedSortKey } from "../components/shared/LastUpdatedCell.jsx";
import AdminTripContributions from "./AdminTripContributions.jsx";
import TabBar from "../components/shared/TabBar.jsx";
import StatTiles from "../components/shared/StatTiles.jsx";

// Two tabs plus Log Contributions share one filter-bar/table shell: "Existing Trips" (every real
// Trip row) and "Plan a Trip" (partner-centric: blends a scheduled trip with the partner's general
// capacity so a partner isn't dropped just because nothing is on the calendar).
function yearOf(value) {
  return value ? String(value).slice(0, 4) : null;
}

// "active" is its own filter value: every status except completed. It is the default because a
// church can have 100+ completed trips and "what's currently going on" is the more useful first view.
const STATUS_QUICK_FILTERS = [
  { value: "active", label: "Active (not completed)" },
  { value: "all", label: "All statuses" },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const emptyFilters = {
  status: "active",
  entityType: "all",
  sendingChurch: "all",
  type: "all",
  year: "all",
  minSize: "",
  maxSize: "",
};

function ExistingTripsTab() {
  const navigate = useNavigate();
  const { canWrite, isAdmin, isGuest } = useCurrentUser();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [records, setRecords] = useState([]);
  const [partners, setPartners] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  // Which add-flow the revealed form is on: "planning" (new recruiting trip, default) or "completed" (historical backfill).
  const [addKind, setAddKind] = useState("planning");
  const [newTripPartnerId, setNewTripPartnerId] = useState("");
  const [newTripType, setNewTripType] = useState("");
  const [newTrip, setNewTrip] = useState(emptyTripForm);
  // Click-row popup target for a completed trip; an active trip's row navigates to its detail page. { id, form, entityName }.
  const [tripDetail, setTripDetail] = useState(null);

  function reload() {
    fetchTrips(filters.sendingChurch !== "all" ? { sendingChurch: filters.sendingChurch } : {})
      .then(setRecords)
      .catch(console.error);
  }

  useEffect(() => {
    fetchPartners().then(setPartners).catch(console.error);
  }, []);

  const trips = useMemo(
    () =>
      records.map((t) => ({
        ...t,
        entityType: t.partner?.kind || "missionary",
        entityName: t.partner?.displayName || "—",
        entityLink: t.partner ? `/admin/partners/${t.partner.id}` : null,
        size: (t.participants || []).length,
        raised: (t.contributions || []).reduce((sum, c) => sum + c.amount, 0),
        // null for a trip with no startDate or one already underway/past (negative days-until isn't useful).
        daysUntilDeparture:
          t.startDate && new Date(t.startDate) > new Date()
            ? Math.ceil((new Date(t.startDate) - new Date()) / (1000 * 60 * 60 * 24))
            : null,
      })),
    [records]
  );

  const typeOptions = useMemo(
    () => Array.from(new Set(trips.map((t) => t.type).filter(Boolean))).sort(),
    [trips]
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(trips.map((t) => yearOf(t.startDate)).filter(Boolean))).sort((a, b) => b - a),
    [trips]
  );

  const sendingChurchField = useSendingChurchField();
  const fields = useMemo(
    () => [
      // Rendered via `pills`, not the field grid; listed so useFilterState handles URL-sync/reset.
      { name: "status" },
      PARTNER_TYPE_FILTER_FIELD,
      ...(sendingChurchField ? [sendingChurchField] : []),
      {
        name: "type",
        label: "Trip Type",
        type: "select",
        options: [{ value: "all", label: "All" }, ...typeOptions.map((t) => ({ value: t, label: t }))],
      },
      {
        name: "year",
        label: "Year",
        type: "select",
        options: [
          { value: "all", label: "All" },
          ...yearOptions.map((y) => ({ value: String(y), label: String(y) })),
        ],
      },
      { name: "minSize", label: "Min Team Size", type: "number" },
      { name: "maxSize", label: "Max Team Size", type: "number" },
    ],
    [typeOptions, yearOptions, sendingChurchField]
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);

  // Reload when the sending church changes (it narrows the request itself).
  useEffect(reload, [filters.sendingChurch]);
  const {
    partnerId: filterPartnerId,
    partnerName: filterPartnerName,
    clearPartnerFilter,
    setPartnerFilter,
  } = usePartnerUrlFilter();

  // Partner Detail's "+ Add" links here with ?partnerId= and ?newTrip=1 to open the new-trip form for
  // that partner; ?newTrip= is stripped afterwards so a refresh doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("newTrip") === "1" && filterPartnerId) {
      setShowAddForm(true);
      setAddKind("planning");
      setNewTripPartnerId(filterPartnerId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("newTrip");
          return next;
        },
        { replace: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTrips = trips.filter((t) => {
    if (filterPartnerId && t.partner?.id !== filterPartnerId) return false;
    if (filters.status === "active" && t.status === "completed") return false;
    if (filters.status !== "all" && filters.status !== "active" && t.status !== filters.status) return false;
    if (filters.entityType !== "all" && t.entityType !== filters.entityType) return false;
    if (filters.type !== "all" && t.type !== filters.type) return false;
    if (filters.year !== "all" && yearOf(t.startDate) !== filters.year) return false;
    if (filters.minSize !== "" && t.size < Number(filters.minSize)) return false;
    if (filters.maxSize !== "" && t.size > Number(filters.maxSize)) return false;
    return true;
  });

  const totalParticipants = filteredTrips.reduce((sum, t) => sum + t.size, 0);
  // All-time counts, ignoring filters, so the (possibly filtered) tiles aren't mistaken for totals.
  const allTimeTripCount = trips.length;
  const allTimeParticipants = trips.reduce((sum, t) => sum + t.size, 0);
  const {
    visible: visibleTrips,
    hasMore,
    remaining,
    showMore,
  } = useLoadMore(filteredTrips, { initialCount: 25, step: 25 });

  async function submitAddCompletedTrip() {
    if (!newTrip.partnerId) throw new Error("Choose a partner");
    await createTrip({
      partnerId: newTrip.partnerId,
      status: "completed",
      startDate: newTrip.startDate || null,
      endDate: newTrip.endDate || null,
      type: newTrip.type || null,
      description: newTrip.description || null,
      notes: newTrip.notes || null,
      albumProvider: newTrip.albumProvider || null,
      albumUrl: newTrip.albumUrl || null,
      participants: cleanTripParticipants(newTrip.participants),
    });
    setNewTrip(emptyTripForm);
    reload();
  }

  // Same createTrip({status: "planning"}) shape (with team-size auto-fill) as the Plan a Trip tab; lands on the new trip.
  async function submitStartNewTrip() {
    if (!newTripPartnerId) throw new Error("Choose a partner");
    const partner = partners.find((p) => p.id === newTripPartnerId);
    const created = await createTrip({
      partnerId: newTripPartnerId,
      status: "planning",
      teamSizeMin: partner?.tripTeamSizeMin ?? null,
      teamSizeMax: partner?.tripTeamSizeMax ?? null,
      type: newTripType || null,
    });
    navigate(`/admin/trips/${created.id}`);
  }

  // Only reachable for a completed trip; an active trip's row navigates to its detail page.
  function openTripDetail(trip) {
    setTripDetail({
      id: trip.id,
      entityName: trip.entityName,
      form: {
        partnerId: "",
        startDate: toDateInputValue(trip.startDate),
        endDate: toDateInputValue(trip.endDate),
        type: trip.type || "",
        description: trip.description || "",
        notes: trip.notes || "",
        albumProvider: trip.albumProvider || null,
        albumUrl: trip.albumUrl || null,
        participants: (trip.participants || []).map((p) => ({ ...p })),
      },
    });
  }

  function setTripDetailForm(updater) {
    setTripDetail((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitTripDetail() {
    await updateTrip(tripDetail.id, {
      startDate: tripDetail.form.startDate || null,
      endDate: tripDetail.form.endDate || null,
      type: tripDetail.form.type || null,
      description: tripDetail.form.description || null,
      notes: tripDetail.form.notes || null,
      albumProvider: tripDetail.form.albumProvider || null,
      albumUrl: tripDetail.form.albumUrl || null,
      participants: cleanTripParticipants(tripDetail.form.participants),
    });
    reload();
  }

  async function handleDelete(trip) {
    const confirmed = await confirmDialog({
      title: `Delete this trip for ${trip.entityName}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTrip(trip.id);
    reload();
  }

  return (
    <div>
      {filterPartnerId && (
        <Breadcrumb
          items={[
            { label: "Partners", to: "/admin/partners" },
            { label: filterPartnerName || "…", to: `/admin/partners/${filterPartnerId}` },
            { label: "Trips" },
          ]}
        />
      )}
      {canWrite && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn"
            onClick={() => {
              setShowAddForm(true);
              setAddKind("planning");
            }}
          >
            + New Trip
          </button>
        </div>
      )}

      {canWrite && showAddForm && (
        <QuickActionModal
          title="New Trip"
          onClose={() => setShowAddForm(false)}
          onSubmit={addKind === "planning" ? submitStartNewTrip : submitAddCompletedTrip}
          submitLabel={addKind === "planning" ? "Start Trip" : "Save Trip"}
        >
          <div className="admin-checkbox-row" style={{ marginBottom: "1rem" }}>
            <label>
              <input
                type="radio"
                name="addKind"
                checked={addKind === "planning"}
                onChange={() => setAddKind("planning")}
              />
              Start recruiting a new trip
            </label>
            <label>
              <input
                type="radio"
                name="addKind"
                checked={addKind === "completed"}
                onChange={() => setAddKind("completed")}
              />
              Log a trip that already happened
            </label>
          </div>

          {addKind === "planning" ? (
            <>
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Partner
                  <PartnerSelect
                    partners={partners}
                    value={newTripPartnerId}
                    onChange={setNewTripPartnerId}
                    required
                  />
                </label>
                <label>
                  Trip Type
                  <PresetOrCustomSelect
                    value={newTripType}
                    onChange={setNewTripType}
                    presets={TRIP_TYPE_PRESETS}
                    placeholder="e.g. Photography"
                  />
                </label>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
                Creates the trip and takes you to its own page to set dates, team size, and start recruiting.
              </p>
            </>
          ) : (
            <TripFormFields
              form={newTrip}
              setForm={setNewTrip}
              partnerPicker={
                <label style={{ gridColumn: "1 / -1" }}>
                  Partner
                  <PartnerSelect
                    partners={partners}
                    value={newTrip.partnerId}
                    onChange={(partnerId) => setNewTrip((f) => ({ ...f, partnerId }))}
                    required
                  />
                </label>
              }
            />
          )}
        </QuickActionModal>
      )}

      <FilterBar
        fields={fields}
        values={filters}
        onChange={updateFilter}
        onReset={resetFilters}
        pills={{ field: "status", options: STATUS_QUICK_FILTERS }}
        extraChips={
          <PartnerFilterChip
            partnerId={filterPartnerId}
            partnerName={filterPartnerName}
            partners={partners}
            onSelect={setPartnerFilter}
            onClear={clearPartnerFilter}
          />
        }
      />

      <StatTiles
        ariaLabel="Trip counts"
        items={[
          {
            label: "Trips",
            value: filteredTrips.length,
            hint: filteredTrips.length !== allTimeTripCount ? `of ${allTimeTripCount} total` : null,
          },
          {
            label: "Total participants",
            value: totalParticipants,
            hint: totalParticipants !== allTimeParticipants ? `of ${allTimeParticipants} total` : null,
          },
        ]}
      />

      <Table
        className="admin-table"
        style={{ marginTop: "1rem" }}
        rows={visibleTrips}
        rowKey={(trip) => trip.id}
        onRowClick={(trip) =>
          trip.status === "completed" ? openTripDetail(trip) : navigate(`/admin/trips/${trip.id}`)
        }
        // A trip with a page opens it; a completed one opens its history dialog instead.
        rowHref={(trip) => (trip.status === "completed" ? null : `/admin/trips/${trip.id}`)}
        emptyMessage={
          <EmptyListMessage
            filtered={filtersActive(filters, emptyFilters) || Boolean(filterPartnerId)}
            filteredText="No trips match these filters."
            onClear={resetFilters}
          >
            No trips yet. A trip is a team going to serve with one of your partners, with its own team,
            meetings, requirements and money.
            {canWrite && (
              <>
                {" "}
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setShowAddForm(true);
                    setAddKind("planning");
                  }}
                >
                  + Plan the first trip
                </button>
              </>
            )}
          </EmptyListMessage>
        }
        columns={[
          {
            key: "entityName",
            label: "Partner",
            stopRowClick: true,
            render: (trip) => (
              <>
                <span style={{ fontWeight: 600 }}>{trip.entityName}</span>
                {trip.partner?.isRestricted && (
                  <div style={{ fontSize: "0.7rem", color: "var(--warn)", fontWeight: 700 }}>
                    Restricted partner
                  </div>
                )}
              </>
            ),
          },
          {
            key: "status",
            label: "Status",
            render: (trip) => (
              <>
                <TripStatusBadge status={trip.status} />
                {/* Same conditions as the notification bell; a per-row indicator for categories that can't link to one trip. */}
                {(trip.hasPendingApplications ||
                  trip.hasOverdueRequirement ||
                  trip.departingSoonIncomplete) && (
                  <div
                    style={{ fontSize: "0.7rem", color: "var(--warn)", fontWeight: 600, marginTop: "0.2rem" }}
                  >
                    {trip.hasPendingApplications && <div>📝 Pending application</div>}
                    {trip.hasOverdueRequirement && <div>⏰ Overdue requirement</div>}
                    {trip.departingSoonIncomplete && <div>⏳ Departing soon, incomplete</div>}
                  </div>
                )}
              </>
            ),
          },
          {
            key: "startDate",
            label: "Dates",
            render: (trip) => (
              <>
                {trip.startDate || trip.endDate
                  ? `${formatDate(trip.startDate) || "?"} – ${formatDate(trip.endDate) || "?"}`
                  : "—"}
                {trip.daysUntilDeparture != null && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {trip.daysUntilDeparture} days until departure
                  </div>
                )}
              </>
            ),
          },
          {
            key: "size",
            label: "Team",
            render: (trip) => (
              <>
                {trip.size} / {trip.teamSizeMax ?? "?"} filled
              </>
            ),
          },
          {
            key: "raised",
            label: "Raised",
            render: (trip) => (
              <>
                ${trip.raised}
                {trip.supportRaisingGoal ? ` / ${formatCurrency(trip.supportRaisingGoal)}` : ""}
              </>
            ),
          },
          // When the trip, or any part of it (team, meetings, requirements, money),
          // was last changed (staff only: a guest's list carries no editor names).
          ...(isGuest
            ? []
            : [
                {
                  key: "createdAt",
                  label: "Added",
                  sortable: true,
                  sortBy: (trip) => lastUpdatedSortKey(trip.createdAt),
                  render: (trip) => (trip.createdAt ? formatDate(trip.createdAt) : ""),
                },
                {
                  key: "lastUpdatedAt",
                  label: "Last updated",
                  sortable: true,
                  sortBy: (trip) => lastUpdatedSortKey(trip.lastUpdatedAt),
                  render: (trip) => <LastUpdatedCell at={trip.lastUpdatedAt} name={trip.lastUpdatedByName} />,
                },
              ]),
        ]}
        renderActions={(trip) => (
          <>
            {isAdmin && (
              <button
                type="button"
                className="btn danger small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(trip);
                }}
              >
                Delete
              </button>
            )}
          </>
        )}
      />
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />

      {tripDetail &&
        (canWrite ? (
          <QuickActionModal
            title={`Trip — ${tripDetail.entityName}`}
            onClose={() => setTripDetail(null)}
            onSubmit={submitTripDetail}
          >
            <TripFormFields form={tripDetail.form} setForm={setTripDetailForm} />
          </QuickActionModal>
        ) : (
          <Modal title={`Trip — ${tripDetail.entityName}`} onClose={() => setTripDetail(null)}>
            <Field
              label="Dates"
              value={
                tripDetail.form.startDate || tripDetail.form.endDate
                  ? `${formatDate(tripDetail.form.startDate) || "?"} – ${formatDate(tripDetail.form.endDate) || "?"}`
                  : null
              }
              showEmpty
            />
            <Field label="Trip Type" value={tripDetail.form.type} showEmpty />
            <Field label="Description" value={tripDetail.form.description} showEmpty />
            <Field label="Notes" value={tripDetail.form.notes} showEmpty />
            <Field
              label="Participants"
              value={
                tripDetail.form.participants.length > 0
                  ? tripDetail.form.participants
                      .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" "))
                      .join(", ")
                  : null
              }
              showEmpty
            />
          </Modal>
        ))}
      {confirmElement}
    </div>
  );
}

const KIND_LABELS = {
  open: "Open",
  committed: "Committed",
  fallback: "No trip scheduled",
};
const KIND_COLORS = {
  open: "#1f6b4f",
  committed: "#2a5d8f",
  fallback: "#6b6f76",
};

function teamSizeLabel(min, max) {
  if (min == null && max == null) return "Not specified";
  return `${min ?? "?"} – ${max ?? "?"}`;
}

const QUICK_FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "committed", label: "Committed" },
  { value: "fallback", label: "No trip scheduled" },
];

function PlanATripTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cloningId, setCloningId] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const navigate = useNavigate();
  const { canWrite } = useCurrentUser();

  useEffect(() => {
    fetchTripPlanning()
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const tripTypes = [...new Set(rows.flatMap((r) => r.tripTypesSupported || []))].sort();

  const fields = useMemo(
    () => [
      { name: "quickFilter" }, // rendered via `pills`, not the field grid
      { name: "search", label: "Search partner name" },
      {
        name: "type",
        label: "Trip Type",
        type: "select",
        options: [{ value: "all", label: "All" }, ...tripTypes.map((t) => ({ value: t, label: t }))],
      },
      { name: "minSize", label: "Min Team Size", type: "number" },
      { name: "maxSize", label: "Max Team Size", type: "number" },
      // Team-size filter: effective size is the trip's own min/max, else the partner's capacity; ranges match on overlap.
      { name: "neverBeenOnly", label: "Never been (no past trips)", type: "checkbox" },
    ],
    [tripTypes]
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, {
    quickFilter: "all",
    search: "",
    type: "all",
    minSize: "",
    maxSize: "",
    neverBeenOnly: false,
  });

  const visibleRows = rows.filter((row) => {
    if (filters.quickFilter !== "all" && row.kind !== filters.quickFilter) return false;
    if (filters.search && !row.displayName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.type !== "all" && !(row.tripTypesSupported || []).includes(filters.type)) return false;
    if (filters.neverBeenOnly && row.pastTripCount > 0) return false;
    const effectiveMin = row.trip?.teamSizeMin ?? row.teamSizeMin;
    const effectiveMax = row.trip?.teamSizeMax ?? row.teamSizeMax;
    if (filters.minSize !== "" && effectiveMax != null && effectiveMax < Number(filters.minSize))
      return false;
    if (filters.maxSize !== "" && effectiveMin != null && effectiveMin > Number(filters.maxSize))
      return false;
    return true;
  });

  const {
    visible: visibleRowsPage,
    hasMore,
    remaining,
    showMore,
  } = useLoadMore(visibleRows, { initialCount: 25, step: 25 });

  async function handleStartTrip(row) {
    setStartingId(row.partnerId);
    try {
      const created = await createTrip({
        partnerId: row.partnerId,
        status: "planning",
        teamSizeMin: row.teamSizeMin,
        teamSizeMax: row.teamSizeMax,
        type: row.tripTypesSupported?.[0] || null,
      });
      navigate(`/admin/trips/${created.id}`);
    } catch (err) {
      console.error(err);
      setStartingId(null);
    }
  }

  async function handleClone(row) {
    if (!row.cloneFromTripId) return;
    setCloningId(row.partnerId);
    try {
      const cloned = await cloneTrip(row.cloneFromTripId);
      navigate(`/admin/trips/${cloned.id}`);
    } catch (err) {
      console.error(err);
      setCloningId(null);
    }
  }

  return (
    <div>
      <FilterBar
        fields={fields}
        values={filters}
        onChange={updateFilter}
        onReset={resetFilters}
        pills={{ field: "quickFilter", options: QUICK_FILTERS }}
      />

      {loading ? (
        <p>Loading…</p>
      ) : (
        <Table
          style={{ marginTop: "1rem" }}
          rows={visibleRowsPage}
          rowKey={(row) => row.partnerId}
          emptyMessage={
            rows.length === 0
              ? "No partners with trip capacity on file yet."
              : "No partners match these filters."
          }
          columns={[
            {
              key: "displayName",
              label: "Partner",
              render: (row) => (
                <>
                  <Link to={`/admin/partners/${row.partnerId}`} style={{ fontWeight: 600 }}>
                    {row.displayName}
                  </Link>
                  {row.isRestricted && (
                    <div style={{ fontSize: "0.7rem", color: "var(--warn)", fontWeight: 700 }}>
                      Restricted partner — won't be publicly discoverable regardless of any trip setting
                    </div>
                  )}
                </>
              ),
            },
            {
              key: "kind",
              label: "Status",
              render: (row) => (
                <>
                  <StatusPill label={KIND_LABELS[row.kind]} color={KIND_COLORS[row.kind]} />
                  {row.kind !== "fallback" && (
                    <div style={{ marginTop: "0.2rem" }}>
                      <Link to={`/admin/trips/${row.trip.id}`} style={{ fontSize: "0.78rem" }}>
                        View trip →
                      </Link>
                    </div>
                  )}
                </>
              ),
            },
            {
              key: "dates",
              label: "Dates",
              render: (row) =>
                row.trip?.startDate || row.trip?.endDate
                  ? `${formatDate(row.trip.startDate) || "?"} – ${formatDate(row.trip.endDate) || "?"}`
                  : "—",
            },
            {
              key: "team",
              label: "Team",
              render: (row) =>
                row.trip
                  ? `${(row.trip.participants || []).length} / ${row.trip.teamSizeMax ?? row.teamSizeMax ?? "?"} filled`
                  : teamSizeLabel(row.teamSizeMin, row.teamSizeMax),
            },
            {
              key: "pastTripCount",
              label: "Past Trips",
              render: (row) => (
                <>
                  {row.pastTripCount} trip{row.pastTripCount === 1 ? "" : "s"}
                  {row.mostRecentPastTripDate && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      last {formatDate(row.mostRecentPastTripDate)}
                    </div>
                  )}
                </>
              ),
            },
          ]}
          renderActions={(row) => (
            <>
              {canWrite && row.kind === "fallback" && (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={startingId === row.partnerId}
                  onClick={() => handleStartTrip(row)}
                >
                  {startingId === row.partnerId ? "Starting…" : "Start a new trip"}
                </button>
              )}
              {canWrite && row.cloneFromTripId && (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={cloningId === row.partnerId}
                  onClick={() => handleClone(row)}
                >
                  {cloningId === row.partnerId ? "Cloning…" : "Clone trip"}
                </button>
              )}
            </>
          )}
        />
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />
    </div>
  );
}

const TABS = [
  {
    value: "existing",
    label: "Existing Trips",
    description:
      "Every trip, every status — a searchable record. A quick historical backfill is managed right here; an actively-recruited trip's team, applications, meetings, and support raising live on its own detail page.",
  },
  {
    value: "plan",
    label: "Plan a Trip",
    description:
      "Partners who could host a trip, including ones with nothing scheduled yet — blends what's already scheduled with each partner's general trip capacity, so a partner is never dropped from the list just because nothing concrete is on the calendar.",
  },
  {
    value: "contributions",
    label: "Log Contributions",
    description:
      "Pick a trip and a team member (or leave it trip-wide), then log a gift the same way the trip's own Financial tab does — built for working through a stack of checks for several trips/team members without navigating back and forth.",
  },
];

export default function AdminTrips() {
  const location = useLocation();
  const navigate = useNavigate();
  // A guest sees the same Trips page as everyone, with just the one tab
  // they can use: their own trips. Planning and logging gifts are staff's.
  const { isGuest } = useCurrentUser();
  const visibleTabs = isGuest ? TABS.filter((t) => t.value === "existing") : TABS;
  // All three paths render this component; URL-backed tabs so a refresh/bookmark lands on the same tab.
  const requestedTab = location.pathname.endsWith("/planning")
    ? "plan"
    : location.pathname.endsWith("/contributions")
      ? "contributions"
      : "existing";
  const tab = isGuest ? "existing" : requestedTab;
  const activeTab = TABS.find((t) => t.value === tab) || TABS[0];

  const TAB_PATHS = {
    plan: "/admin/trips/planning",
    contributions: "/admin/trips/contributions",
    existing: "/admin/trips",
  };

  function selectTab(value) {
    navigate(TAB_PATHS[value] || TAB_PATHS.existing);
  }

  return (
    <div className="admin-shell">
      <PageHeader title="Trips" />
      <TabBar
        ariaLabel="Trips views"
        activeKey={tab}
        tabs={visibleTabs.map((t) => ({ key: t.value, label: t.label, onClick: () => selectTab(t.value) }))}
      />
      <p style={{ color: "var(--muted)", marginTop: 0 }}>{activeTab.description}</p>

      {tab === "existing" && <ExistingTripsTab />}
      {tab === "plan" && <PlanATripTab />}
      {tab === "contributions" && <AdminTripContributions />}
    </div>
  );
}
