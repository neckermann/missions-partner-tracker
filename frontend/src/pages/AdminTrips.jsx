import React, { useEffect, useMemo, useState } from "react";
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
import { formatDate, toDateInputValue } from "../utils/format.js";
import { partnerKindLabel, PARTNER_TYPE_FILTER_FIELD } from "../utils/partnerEntity.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import TripStatusBadge, { STATUS_LABELS } from "../components/admin/TripStatusBadge.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import PartnerFilterChip from "../components/shared/PartnerFilterChip.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import usePartnerUrlFilter from "../hooks/usePartnerUrlFilter.js";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

// Merged (design review, post-#252) from two previously separate pages/
// nav items -- AdminTrips.jsx ("Trips": every real Trip row, a
// searchable record) and AdminTripPlanning.jsx ("Plan a Trip":
// partner-centric, blends an already-scheduled open/committed trip with
// a partner's own general capacity so a partner is never dropped from
// the list just because nothing concrete is on the calendar). Both
// questions are still genuinely different queries -- that didn't
// change -- but presenting them as two separate pages with two
// different filter-bar idioms, two different badge components, and a
// one-line cross-reference each made the real distinction look like an
// accidental one. One page, one nav item, two tabs: same filter-bar
// shell, same status-pill rendering, same table shell -- only the
// query/columns/row-actions differ per tab.
function yearOf(value) {
  return value ? String(value).slice(0, 4) : null;
}

// "active" is its own filter value, not one of Trip.status's real four --
// it means "every status except completed" (planning, accepting_applications,
// and closed all still count as upcoming; closed just means the team's set,
// not that the trip happened yet). Default on page load: a demo-scale church
// can easily have 100+ completed trips on file, and "what's currently going
// on" is almost always the more useful first view than scrolling past all of
// those. "All statuses" stays one pill away, not a separate reset action.
const STATUS_QUICK_FILTERS = [
  { value: "active", label: "Active (not completed)" },
  { value: "all", label: "All statuses" },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const emptyFilters = {
  status: "active",
  entityType: "all",
  type: "all",
  year: "all",
  minSize: "",
  maxSize: "",
};

function ExistingTripsTab() {
  const navigate = useNavigate();
  const { canWrite, isAdmin } = useCurrentUser();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [records, setRecords] = useState([]);
  const [partners, setPartners] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  // Which of the two add-flows the revealed form is on -- "planning"
  // (start a new recruiting trip) is the default; "completed" (today's
  // historical-backfill form) is the alternative, not a second button --
  // one form, one explicit choice.
  const [addKind, setAddKind] = useState("planning");
  const [newTripPartnerId, setNewTripPartnerId] = useState("");
  const [newTripType, setNewTripType] = useState("");
  const [newTrip, setNewTrip] = useState(emptyTripForm);
  // The click-row-opens-popup target for a completed trip (the only kind
  // editable from this list -- an active trip's real multi-page detail
  // view is a richer destination than a popup, so its row still
  // navigates there instead). { id, form, entityName }.
  const [tripDetail, setTripDetail] = useState(null);

  function reload() {
    fetchTrips().then(setRecords).catch(console.error);
  }

  useEffect(() => {
    reload();
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
        // Folded in from the now-removed AdminTripDashboard.jsx (issue
        // #259) -- null for a trip with no startDate, or one already
        // underway/past (a negative days-until figure reads as "overdue,"
        // not useful here).
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

  const fields = useMemo(
    () => [
      // Rendered via `pills` below, not the field grid -- present here so
      // useFilterState knows about it for URL-sync/reset purposes.
      { name: "status" },
      PARTNER_TYPE_FILTER_FIELD,
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
    [typeOptions, yearOptions]
  );
  const {
    values: filters,
    setValue: updateFilter,
    reset: resetFilters,
  } = useFilterState(fields, emptyFilters);
  const {
    partnerId: filterPartnerId,
    partnerName: filterPartnerName,
    clearPartnerFilter,
    setPartnerFilter,
  } = usePartnerUrlFilter();

  // Partner Detail's Mission Trips "+ Add" links here with both
  // ?partnerId= (the existing filter) and ?newTrip=1, to open straight
  // into "start a new trip" pre-selected to that partner instead of
  // landing on the filtered list and making someone find the button
  // themselves. Strips ?newTrip= right after so refreshing/revisiting
  // this URL later doesn't keep reopening the form.
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
  // All-time counts, ignoring every filter -- shown alongside the
  // (possibly filtered) tiles below so neither number reads as an
  // all-time total when it secretly isn't. Computed off `trips`, not
  // `filteredTrips`.
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

  // Reuses the exact createTrip({status: "planning", ...}) shape the
  // Plan a Trip tab's own "Start a new trip" button makes (same
  // team-size auto-fill from the partner's own tripTeamSizeMin/Max) --
  // lands on the trip's own detail page immediately, same as that tab
  // does, since there's nothing useful left to do on this list once the
  // trip exists.
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

  // Only reachable for a completed trip -- see the Table's onRowClick
  // below. An active trip's own multi-page detail view (team/meetings/
  // requirements/budget/flights) is a richer destination than a popup
  // could hold, so it keeps navigating there instead.
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
              <p style={{ color: "#888", fontSize: "0.85rem", marginTop: "0.5rem" }}>
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

      <div className="admin-section">
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Trips</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>
              {filteredTrips.length}
              {filteredTrips.length !== allTimeTripCount && (
                <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "#888" }}>
                  {" "}
                  of {allTimeTripCount} total
                </span>
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
              Total Participants
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>
              {totalParticipants}
              {totalParticipants !== allTimeParticipants && (
                <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "#888" }}>
                  {" "}
                  of {allTimeParticipants} total
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <Table
        className="admin-table"
        style={{ marginTop: "1rem" }}
        rows={visibleTrips}
        rowKey={(trip) => trip.id}
        onRowClick={(trip) =>
          trip.status === "completed" ? openTripDetail(trip) : navigate(`/admin/trips/${trip.id}`)
        }
        emptyMessage="No trips match these filters."
        columns={[
          {
            key: "entityName",
            label: "Partner",
            stopRowClick: true,
            render: (trip) => (
              <>
                <Link to={trip.entityLink} style={{ fontWeight: 600 }}>
                  {trip.entityName}
                </Link>
                {trip.partner?.isRestricted && (
                  <div style={{ fontSize: "0.7rem", color: "#a6540f", fontWeight: 700 }}>
                    Restricted partner
                  </div>
                )}
              </>
            ),
          },
          { key: "entityType", label: "Type", render: (trip) => partnerKindLabel(trip.entityType) },
          {
            key: "status",
            label: "Status",
            render: (trip) => (
              <>
                <TripStatusBadge status={trip.status} />
                {/* Same conditions the in-app notification bell surfaces for
                    this trip -- a per-row indicator here is the fallback for
                    when a category can't link straight to one specific trip
                    (several are responsible at once), so this list is still
                    where someone can visually find the right one. */}
                {(trip.hasPendingApplications ||
                  trip.hasOverdueRequirement ||
                  trip.departingSoonIncomplete) && (
                  <div style={{ fontSize: "0.7rem", color: "#a6540f", fontWeight: 600, marginTop: "0.2rem" }}>
                    {trip.hasPendingApplications && <div>📝 Pending application</div>}
                    {trip.hasOverdueRequirement && <div>⏰ Overdue requirement</div>}
                    {trip.departingSoonIncomplete && <div>⏳ Departing soon, incomplete</div>}
                  </div>
                )}
              </>
            ),
          },
          { key: "type", label: "Trip Type", render: (trip) => trip.type || "—" },
          {
            key: "startDate",
            label: "Dates",
            render: (trip) => (
              <>
                {trip.startDate || trip.endDate
                  ? `${formatDate(trip.startDate) || "?"} – ${formatDate(trip.endDate) || "?"}`
                  : "—"}
                {trip.daysUntilDeparture != null && (
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>
                    {trip.daysUntilDeparture} days until departure
                  </div>
                )}
              </>
            ),
          },
          {
            key: "size",
            label: "Team",
            render: (trip) => {
              const leaders = (trip.participants || [])
                .filter((p) => p.isLeader)
                .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" "));
              return (
                <>
                  {trip.size} / {trip.teamSizeMax ?? "?"} filled
                  {leaders.length > 0 && (
                    <div style={{ fontSize: "0.75rem", color: "#888" }}>{leaders.join(", ")}</div>
                  )}
                </>
              );
            },
          },
          {
            key: "raised",
            label: "Raised",
            render: (trip) => (
              <>
                ${trip.raised}
                {trip.supportRaisingGoal ? ` / $${trip.supportRaisingGoal}` : ""}
              </>
            ),
          },
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

// Action-link style shared by this tab's "Clone trip" secondary action --
// same idiom as the Status column's badge+"View trip →" link pairing
// just below it (a primary element, a small text link underneath), but
// "Clone trip" triggers an API call before navigating rather than being
// a plain navigation, so it has to stay a <button> styled to read as a
// link rather than an actual <Link>.
const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#1f6b4f",
  textDecoration: "underline",
  cursor: "pointer",
  fontSize: "0.78rem",
};

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
      // Team-size range filter -- effective size is the open/committed
      // trip's own teamSizeMin/Max when one exists, else the partner's
      // general capacity. "Matches" means the two ranges overlap, not
      // that the row's range sits entirely inside the filter's.
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

  // Real gap this tab closes: before it existed, starting a trip for a
  // partner with no prior one had no UI path at all -- the Existing
  // Trips tab's own add-flow only ever created a status: "completed"
  // (historical) trip.
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
                    <div style={{ fontSize: "0.7rem", color: "#a6540f", fontWeight: 700 }}>
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
                    <div style={{ fontSize: "0.75rem", color: "#888" }}>
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
                <div style={{ marginTop: row.kind === "fallback" ? "0.3rem" : 0 }}>
                  <button
                    type="button"
                    style={linkButtonStyle}
                    disabled={cloningId === row.partnerId}
                    onClick={() => handleClone(row)}
                  >
                    {cloningId === row.partnerId ? "Cloning…" : "Clone trip"}
                  </button>
                </div>
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
];

export default function AdminTrips() {
  const location = useLocation();
  const navigate = useNavigate();
  // Both /admin/trips and /admin/trips/planning render this same
  // component -- real tabs now (URL-backed, not just local state), same
  // tab-bar treatment TripDetailLayout.jsx already uses for its own real
  // sub-nav, so refreshing/bookmarking/sharing a link to either tab lands
  // back on that same tab instead of always defaulting to Existing Trips.
  const tab = location.pathname.endsWith("/planning") ? "plan" : "existing";
  const activeTab = TABS.find((t) => t.value === tab) || TABS[0];

  function selectTab(value) {
    navigate(value === "plan" ? "/admin/trips/planning" : "/admin/trips");
  }

  return (
    <div className="admin-shell">
      <h2>Trips</h2>
      <div
        style={{
          display: "flex",
          gap: "0.3rem",
          marginTop: "0.5rem",
          borderBottom: "1px solid #e1dfdb",
          flexWrap: "wrap",
        }}
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => selectTab(t.value)}
            style={{
              padding: "0.5rem 0.8rem",
              fontSize: "0.85rem",
              fontWeight: tab === t.value ? 700 : 400,
              color: tab === t.value ? "#1f2a37" : "#555",
              background: "none",
              border: "none",
              borderBottom: tab === t.value ? "2px solid #1f2a37" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p style={{ color: "#555", marginTop: "0.5rem" }}>{activeTab.description}</p>

      {tab === "existing" ? <ExistingTripsTab /> : <PlanATripTab />}
    </div>
  );
}
