import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
import AlbumLinkField from "../components/admin/AlbumLinkField.jsx";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import { formatDate, toDateInputValue } from "../utils/format.js";
import { partnerKindLabel } from "../utils/partnerEntity.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import TripStatusBadge, { STATUS_LABELS } from "../components/admin/TripStatusBadge.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import TripFilterBar from "../components/admin/TripFilterBar.jsx";

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

const TRIP_TYPE_PRESETS = [
  "Construction",
  "Medical/Dental",
  "VBS/Children's Ministry",
  "Evangelism/Outreach",
  "Teaching/Discipleship",
  "Prayer",
  "General Labor",
  "Sports Ministry",
  "Music/Worship",
  "Administrative/Support",
];

const emptyParticipant = { firstName: "", lastName: "", role: "", isLeader: false, phone: "", email: "" };
const emptyTripForm = {
  partnerId: "",
  startDate: "",
  endDate: "",
  type: "",
  description: "",
  notes: "",
  albumProvider: null,
  albumUrl: null,
  participants: [],
};

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
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [records, setRecords] = useState([]);
  const [partners, setPartners] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [showAddForm, setShowAddForm] = useState(false);
  // Which of the two add-flows the revealed form is on -- "planning"
  // (start a new recruiting trip) is the default; "completed" (today's
  // historical-backfill form) is the alternative, not a second button --
  // one form, one explicit choice.
  const [addKind, setAddKind] = useState("planning");
  const [newTripPartnerId, setNewTripPartnerId] = useState("");
  const [newTripType, setNewTripType] = useState("");
  const [startingTrip, setStartingTrip] = useState(false);
  const [newTrip, setNewTrip] = useState(emptyTripForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyTripForm);

  function reload() {
    fetchTrips().then(setRecords).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
  }, []);

  function updateFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  const trips = useMemo(
    () =>
      records.map((t) => ({
        ...t,
        entityType: partnerKindLabel(t.partner?.kind),
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

  const filteredTrips = trips.filter((t) => {
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

  function addParticipant(which) {
    const setter = which === "new" ? setNewTrip : setEditForm;
    setter((f) => ({ ...f, participants: [...f.participants, { ...emptyParticipant }] }));
  }
  function updateParticipant(which, index, field, value) {
    const setter = which === "new" ? setNewTrip : setEditForm;
    setter((f) => {
      const next = [...f.participants];
      next[index] = { ...next[index], [field]: value };
      return { ...f, participants: next };
    });
  }
  function removeParticipant(which, index) {
    const setter = which === "new" ? setNewTrip : setEditForm;
    setter((f) => ({ ...f, participants: f.participants.filter((_, i) => i !== index) }));
  }

  function cleanParticipants(participants) {
    return participants.map((p) => ({ ...p, firstName: p.firstName.trim() })).filter((p) => p.firstName);
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newTrip.partnerId) {
      setError("Choose a partner");
      return;
    }
    setSaving(true);
    try {
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
        participants: cleanParticipants(newTrip.participants),
      });
      setNewTrip(emptyTripForm);
      setShowAddForm(false);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save trip");
    } finally {
      setSaving(false);
    }
  }

  // Reuses the exact createTrip({status: "planning", ...}) shape the
  // Plan a Trip tab's own "Start a new trip" button makes (same
  // team-size auto-fill from the partner's own tripTeamSizeMin/Max) --
  // lands on the trip's own detail page immediately, same as that tab
  // does, since there's nothing useful left to do on this list once the
  // trip exists.
  async function handleStartNewTrip(e) {
    e.preventDefault();
    setError("");
    if (!newTripPartnerId) {
      setError("Choose a partner");
      return;
    }
    setStartingTrip(true);
    try {
      const partner = partners.find((p) => p.id === newTripPartnerId);
      const created = await createTrip({
        partnerId: newTripPartnerId,
        status: "planning",
        teamSizeMin: partner?.tripTeamSizeMin ?? null,
        teamSizeMax: partner?.tripTeamSizeMax ?? null,
        type: newTripType || null,
      });
      navigate(`/admin/trips/${created.id}`, { state: { from: "trips" } });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to start trip");
      setStartingTrip(false);
    }
  }

  function startEdit(trip) {
    setError("");
    setEditingId(trip.id);
    setEditForm({
      partnerId: "",
      startDate: toDateInputValue(trip.startDate),
      endDate: toDateInputValue(trip.endDate),
      type: trip.type || "",
      description: trip.description || "",
      notes: trip.notes || "",
      albumProvider: trip.albumProvider || null,
      albumUrl: trip.albumUrl || null,
      participants: (trip.participants || []).map((p) => ({ ...p })),
    });
  }

  async function submitEdit(id) {
    setError("");
    try {
      await updateTrip(id, {
        startDate: editForm.startDate || null,
        endDate: editForm.endDate || null,
        type: editForm.type || null,
        description: editForm.description || null,
        notes: editForm.notes || null,
        albumProvider: editForm.albumProvider || null,
        albumUrl: editForm.albumUrl || null,
        participants: cleanParticipants(editForm.participants),
      });
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save trip");
    }
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

  function renderParticipantsEditor(which, form) {
    return (
      <>
        <h4 style={{ marginTop: "1rem" }}>Participants</h4>
        {form.participants.map((p, pIndex) => (
          <div className="repeatable-row" key={pIndex} style={{ background: "white" }}>
            <button
              type="button"
              className="btn-remove"
              onClick={() => removeParticipant(which, pIndex)}
              title="Remove"
            >
              ✕
            </button>
            <div className="form-grid">
              <label>
                First Name
                <input
                  value={p.firstName}
                  onChange={(e) => updateParticipant(which, pIndex, "firstName", e.target.value)}
                />
              </label>
              <label>
                Last Name
                <input
                  value={p.lastName || ""}
                  onChange={(e) => updateParticipant(which, pIndex, "lastName", e.target.value)}
                />
              </label>
              <label>
                Role
                <input
                  value={p.role || ""}
                  onChange={(e) => updateParticipant(which, pIndex, "role", e.target.value)}
                  placeholder="e.g. Construction"
                />
              </label>
              <label>
                Phone
                <input
                  value={p.phone || ""}
                  onChange={(e) => updateParticipant(which, pIndex, "phone", e.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  value={p.email || ""}
                  onChange={(e) => updateParticipant(which, pIndex, "email", e.target.value)}
                />
              </label>
            </div>
            <div className="admin-checkbox-row" style={{ marginTop: "0.5rem" }}>
              <label>
                <input
                  type="checkbox"
                  checked={!!p.isLeader}
                  onChange={(e) => updateParticipant(which, pIndex, "isLeader", e.target.checked)}
                />
                Trip Leader
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="btn secondary small" onClick={() => addParticipant(which)}>
          + Add Participant
        </button>
      </>
    );
  }

  return (
    <div className={showAddForm || editingId ? "form-has-floating-actions" : ""}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="btn"
          onClick={() => {
            setShowAddForm((v) => !v);
            setAddKind("planning");
            setError("");
          }}
        >
          {showAddForm ? "Cancel" : "+ New Trip"}
        </button>
      </div>

      {showAddForm && (
        <div className="admin-section" style={{ marginTop: "1rem" }}>
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
            <form onSubmit={handleStartNewTrip}>
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
              <div className="form-save-bar">
                <button type="submit" className="btn" disabled={startingTrip}>
                  {startingTrip ? "Starting…" : "Start Trip"}
                </button>
                {error && (
                  <span style={{ color: "#b91c1c" }} role="alert">
                    {error}
                  </span>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddSubmit}>
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Partner
                  <PartnerSelect
                    partners={partners}
                    value={newTrip.partnerId}
                    onChange={(partnerId) => setNewTrip((f) => ({ ...f, partnerId }))}
                    required
                  />
                </label>
                <label>
                  Start Date
                  <input
                    type="date"
                    value={newTrip.startDate}
                    onChange={(e) => setNewTrip((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </label>
                <label>
                  End Date
                  <input
                    type="date"
                    value={newTrip.endDate}
                    onChange={(e) => setNewTrip((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </label>
                <label>
                  Trip Type
                  <PresetOrCustomSelect
                    value={newTrip.type}
                    onChange={(val) => setNewTrip((f) => ({ ...f, type: val }))}
                    presets={TRIP_TYPE_PRESETS}
                    placeholder="e.g. Photography"
                  />
                </label>
              </div>
              <label style={{ marginTop: "0.75rem" }}>
                Description (what the team did)
                <textarea
                  rows={2}
                  value={newTrip.description}
                  onChange={(e) => setNewTrip((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Notes
                <textarea
                  rows={2}
                  value={newTrip.notes}
                  onChange={(e) => setNewTrip((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Photo/Video Album
                <AlbumLinkField
                  provider={newTrip.albumProvider}
                  url={newTrip.albumUrl}
                  onChange={(provider, url) =>
                    setNewTrip((f) => ({ ...f, albumProvider: provider, albumUrl: url }))
                  }
                />
              </label>
              {renderParticipantsEditor("new", newTrip)}
              <div className="form-save-bar">
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? "Saving..." : "Save Trip"}
                </button>
                {error && (
                  <span style={{ color: "#b91c1c" }} role="alert">
                    {error}
                  </span>
                )}
              </div>
            </form>
          )}
        </div>
      )}

      <TripFilterBar
        pills={{ options: STATUS_QUICK_FILTERS, value: filters.status, onChange: (v) => updateFilter("status", v) }}
        onReset={() => setFilters(emptyFilters)}
      >
        <label>
          Partner Type
          <select value={filters.entityType} onChange={(e) => updateFilter("entityType", e.target.value)}>
            <option value="all">All</option>
            <option value="Missionary">Missionary</option>
            <option value="Organization">Organization</option>
          </select>
        </label>
        <label>
          Trip Type
          <select value={filters.type} onChange={(e) => updateFilter("type", e.target.value)}>
            <option value="all">All</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select value={filters.year} onChange={(e) => updateFilter("year", e.target.value)}>
            <option value="all">All</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min Team Size
          <input
            type="number"
            min="0"
            value={filters.minSize}
            onChange={(e) => updateFilter("minSize", e.target.value)}
          />
        </label>
        <label>
          Max Team Size
          <input
            type="number"
            min="0"
            value={filters.maxSize}
            onChange={(e) => updateFilter("maxSize", e.target.value)}
          />
        </label>
      </TripFilterBar>

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

      <table className="admin-table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Partner</th>
            <th>Type</th>
            <th>Status</th>
            <th>Trip Type</th>
            <th>Dates</th>
            <th>Team</th>
            <th>Raised</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleTrips.map((trip) => {
            const leaders = (trip.participants || [])
              .filter((p) => p.isLeader)
              .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" "));
            const isHistorical = trip.status === "completed";
            return (
              <React.Fragment key={trip.id}>
                <tr
                  onClick={!isHistorical ? () => navigate(`/admin/trips/${trip.id}`) : undefined}
                  style={!isHistorical ? { cursor: "pointer" } : undefined}
                  title={!isHistorical ? "Click to view details" : undefined}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={trip.entityLink}>{trip.entityName}</Link>
                    {trip.partner?.isRestricted && (
                      <div style={{ fontSize: "0.7rem", color: "#a6540f", fontWeight: 700 }}>
                        Restricted partner
                      </div>
                    )}
                  </td>
                  <td>{trip.entityType}</td>
                  <td>
                    <TripStatusBadge status={trip.status} />
                  </td>
                  <td>{trip.type || "—"}</td>
                  <td>
                    {trip.startDate || trip.endDate
                      ? `${formatDate(trip.startDate) || "?"} – ${formatDate(trip.endDate) || "?"}`
                      : "—"}
                    {trip.daysUntilDeparture != null && (
                      <div style={{ fontSize: "0.75rem", color: "#888" }}>
                        {trip.daysUntilDeparture} days until departure
                      </div>
                    )}
                  </td>
                  <td>
                    {trip.size} / {trip.teamSizeMax ?? "?"} filled
                    {leaders.length > 0 && (
                      <div style={{ fontSize: "0.75rem", color: "#888" }}>{leaders.join(", ")}</div>
                    )}
                  </td>
                  <td>
                    ${trip.raised}
                    {trip.supportRaisingGoal ? ` / $${trip.supportRaisingGoal}` : ""}
                  </td>
                  <td className="table-actions" onClick={(e) => e.stopPropagation()}>
                    {isHistorical && (
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => (editingId === trip.id ? setEditingId(null) : startEdit(trip))}
                      >
                        {editingId === trip.id ? "Cancel" : "Edit"}
                      </button>
                    )}
                    <button type="button" className="btn danger small" onClick={() => handleDelete(trip)}>
                      Delete
                    </button>
                  </td>
                </tr>
                {editingId === trip.id && (
                  <tr>
                    <td colSpan={8}>
                      <div className="form-grid">
                        <label>
                          Start Date
                          <input
                            type="date"
                            value={editForm.startDate}
                            onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                          />
                        </label>
                        <label>
                          End Date
                          <input
                            type="date"
                            value={editForm.endDate}
                            onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                          />
                        </label>
                        <label>
                          Trip Type
                          <PresetOrCustomSelect
                            value={editForm.type}
                            onChange={(val) => setEditForm((f) => ({ ...f, type: val }))}
                            presets={TRIP_TYPE_PRESETS}
                            placeholder="e.g. Photography"
                          />
                        </label>
                      </div>
                      <label style={{ marginTop: "0.75rem" }}>
                        Description (what the team did)
                        <textarea
                          rows={2}
                          value={editForm.description}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                        />
                      </label>
                      <label style={{ marginTop: "0.75rem" }}>
                        Notes
                        <textarea
                          rows={2}
                          value={editForm.notes}
                          onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                        />
                      </label>
                      <label style={{ marginTop: "0.75rem" }}>
                        Photo/Video Album
                        <AlbumLinkField
                          provider={editForm.albumProvider}
                          url={editForm.albumUrl}
                          onChange={(provider, url) =>
                            setEditForm((f) => ({ ...f, albumProvider: provider, albumUrl: url }))
                          }
                        />
                      </label>
                      {renderParticipantsEditor("edit", editForm)}
                      <div className="form-save-bar">
                        <button type="button" className="btn small" onClick={() => submitEdit(trip.id)}>
                          Save
                        </button>
                        {error && (
                          <span style={{ color: "#b91c1c" }} role="alert">
                            {error}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {filteredTrips.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: "#888" }}>
                No trips match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />
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
  const [quickFilter, setQuickFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [neverBeenOnly, setNeverBeenOnly] = useState(false);
  // Team-size range filter -- effective size is the open/committed
  // trip's own teamSizeMin/Max when one exists, else the partner's
  // general capacity. "Matches" means the two ranges overlap, not that
  // the row's range sits entirely inside the filter's.
  const [sizeMin, setSizeMin] = useState("");
  const [sizeMax, setSizeMax] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    fetchTripPlanning()
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const tripTypes = [...new Set(rows.flatMap((r) => r.tripTypesSupported || []))].sort();

  function resetFilters() {
    setQuickFilter("all");
    setSearch("");
    setTypeFilter("");
    setNeverBeenOnly(false);
    setSizeMin("");
    setSizeMax("");
  }

  const visibleRows = rows.filter((row) => {
    if (quickFilter !== "all" && row.kind !== quickFilter) return false;
    if (search && !row.displayName.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && !(row.tripTypesSupported || []).includes(typeFilter)) return false;
    if (neverBeenOnly && row.pastTripCount > 0) return false;
    const effectiveMin = row.trip?.teamSizeMin ?? row.teamSizeMin;
    const effectiveMax = row.trip?.teamSizeMax ?? row.teamSizeMax;
    if (sizeMin !== "" && effectiveMax != null && effectiveMax < Number(sizeMin)) return false;
    if (sizeMax !== "" && effectiveMin != null && effectiveMin > Number(sizeMax)) return false;
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
      navigate(`/admin/trips/${created.id}`, { state: { from: "planning" } });
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
      navigate(`/admin/trips/${cloned.id}`, { state: { from: "planning" } });
    } catch (err) {
      console.error(err);
      setCloningId(null);
    }
  }

  return (
    <div>
      <TripFilterBar
        pills={{ options: QUICK_FILTERS, value: quickFilter, onChange: setQuickFilter }}
        onReset={resetFilters}
      >
        <label>
          Search partner name
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          Trip type
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All</option>
            {tripTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min Team Size
          <input type="number" min="0" value={sizeMin} onChange={(e) => setSizeMin(e.target.value)} />
        </label>
        <label>
          Max Team Size
          <input type="number" min="0" value={sizeMax} onChange={(e) => setSizeMax(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
          <input
            type="checkbox"
            checked={neverBeenOnly}
            onChange={(e) => setNeverBeenOnly(e.target.checked)}
            style={{ width: "auto" }}
          />
          Never been (no past trips)
        </label>
      </TripFilterBar>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="admin-table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Partner</th>
              <th>Status</th>
              <th>Dates</th>
              <th>Team</th>
              <th>Past Trips</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRowsPage.map((row) => (
              <tr key={row.partnerId}>
                <td>
                  <Link to={`/admin/partners/${row.partnerId}`}>{row.displayName}</Link>
                  {row.isRestricted && (
                    <div style={{ fontSize: "0.7rem", color: "#a6540f", fontWeight: 700 }}>
                      Restricted partner — won't be publicly discoverable regardless of any trip setting
                    </div>
                  )}
                </td>
                <td>
                  <StatusPill label={KIND_LABELS[row.kind]} color={KIND_COLORS[row.kind]} />
                  {row.kind !== "fallback" && (
                    <div style={{ marginTop: "0.2rem" }}>
                      <Link to={`/admin/trips/${row.trip.id}`} style={{ fontSize: "0.78rem" }}>
                        View trip →
                      </Link>
                    </div>
                  )}
                </td>
                <td>
                  {row.trip?.startDate || row.trip?.endDate
                    ? `${formatDate(row.trip.startDate) || "?"} – ${formatDate(row.trip.endDate) || "?"}`
                    : "—"}
                </td>
                <td>
                  {row.trip
                    ? `${(row.trip.participants || []).length} / ${row.trip.teamSizeMax ?? row.teamSizeMax ?? "?"} filled`
                    : teamSizeLabel(row.teamSizeMin, row.teamSizeMax)}
                </td>
                <td>
                  {row.pastTripCount} trip{row.pastTripCount === 1 ? "" : "s"}
                  {row.mostRecentPastTripDate && (
                    <div style={{ fontSize: "0.75rem", color: "#888" }}>
                      last {formatDate(row.mostRecentPastTripDate)}
                    </div>
                  )}
                </td>
                <td className="table-actions">
                  {row.kind === "fallback" && (
                    <button
                      type="button"
                      className="btn secondary small"
                      disabled={startingId === row.partnerId}
                      onClick={() => handleStartTrip(row)}
                    >
                      {startingId === row.partnerId ? "Starting…" : "Start a new trip"}
                    </button>
                  )}
                  {row.cloneFromTripId && (
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
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "#888" }}>
                  {rows.length === 0
                    ? "No partners with trip capacity on file yet."
                    : "No partners match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />
    </div>
  );
}

const TABS = [
  {
    value: "existing",
    label: "Existing Trips",
    description: "Every trip, every status — a searchable record. A quick historical backfill is managed right here; an actively-recruited trip's team, applications, meetings, and support raising live on its own detail page.",
  },
  {
    value: "plan",
    label: "Plan a Trip",
    description: "Partners who could host a trip, including ones with nothing scheduled yet — blends what's already scheduled with each partner's general trip capacity, so a partner is never dropped from the list just because nothing concrete is on the calendar.",
  },
];

export default function AdminTrips() {
  const location = useLocation();
  // The old /admin/trips/planning URL (bookmarks, the back-link from
  // AdminTripDetail.jsx's `state: { from: "planning" }`) still routes
  // here -- both routes render this same component now -- so it needs
  // to land on the right tab rather than always defaulting to the first
  // one.
  const [tab, setTab] = useState(() => (location.pathname.endsWith("/planning") ? "plan" : "existing"));
  const activeTab = TABS.find((t) => t.value === tab) || TABS[0];

  return (
    <div className="admin-shell">
      <h2>Trips</h2>
      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={tab === t.value ? "btn" : "btn secondary"}
            onClick={() => setTab(t.value)}
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
