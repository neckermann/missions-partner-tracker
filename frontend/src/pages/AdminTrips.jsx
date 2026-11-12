import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTrips, fetchPartners, createTrip, updateTrip, deleteTrip } from "../api/client.js";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";
import AlbumLinkField from "../components/admin/AlbumLinkField.jsx";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import { formatDate, toDateInputValue } from "../utils/format.js";
import { partnerKindLabel } from "../utils/partnerEntity.js";
import useLoadMore from "../hooks/useLoadMore.js";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

// Renamed from AdminTripHistory.jsx (#252) -- "History" became the one
// word the Trip/TripParticipant unification made misleading, since a
// Trip can now also represent something that hasn't happened yet. Every
// trip regardless of status/lifecycle stage lives here; the fuller
// recruiting view (applications/roster/meetings/documents/support raising)
// for an actively-recruited trip is AdminTripDetail.jsx, reached via the
// status badge/link below -- a purely historical backfill is still
// managed entirely inline here, same as before this feature existed.

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

const STATUS_LABELS = {
  planning: "Planning",
  accepting_applications: "Accepting applications",
  closed: "Closed (roster set)",
  completed: "Completed",
};
const STATUS_COLORS = {
  planning: "#a6540f",
  accepting_applications: "#1f6b4f",
  closed: "#2a5d8f",
  completed: "#6b6f76",
};

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  const color = STATUS_COLORS[status] || "#6b6f76";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.7rem",
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        color,
        background: `${color}1a`,
      }}
    >
      {label}
    </span>
  );
}

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

const emptyFilters = {
  entityType: "all",
  type: "all",
  year: "all",
  minSize: "",
  maxSize: "",
};

export default function AdminTrips() {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [records, setRecords] = useState([]);
  const [partners, setPartners] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [showAddForm, setShowAddForm] = useState(false);
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
    if (filters.entityType !== "all" && t.entityType !== filters.entityType) return false;
    if (filters.type !== "all" && t.type !== filters.type) return false;
    if (filters.year !== "all" && yearOf(t.startDate) !== filters.year) return false;
    if (filters.minSize !== "" && t.size < Number(filters.minSize)) return false;
    if (filters.maxSize !== "" && t.size > Number(filters.maxSize)) return false;
    return true;
  });

  const totalParticipants = filteredTrips.reduce((sum, t) => sum + t.size, 0);
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
    <div className={`admin-shell ${showAddForm || editingId ? "form-has-floating-actions" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Trips</h2>
        <button
          className="btn"
          onClick={() => {
            setShowAddForm((v) => !v);
            setError("");
          }}
        >
          {showAddForm ? "Cancel" : "+ Add Trip"}
        </button>
      </div>
      <p style={{ color: "#555" }}>
        Every trip regardless of status. A quick historical backfill is managed right here; an
        actively-recruited trip's roster, applications, meetings, and support raising live on its own detail page.
      </p>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
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

      <div className="admin-section">
        <h3>Filters</h3>
        <div className="form-grid">
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
        </div>
        <button
          type="button"
          className="btn secondary small"
          style={{ marginTop: "1rem" }}
          onClick={() => setFilters(emptyFilters)}
        >
          Reset Filters
        </button>
      </div>

      <div className="admin-section">
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Trips</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{filteredTrips.length}</div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
              Total Participants
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{totalParticipants}</div>
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
            <th>Team Size</th>
            <th>Leader(s)</th>
            <th>Description</th>
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
                <tr>
                  <td>
                    <Link to={trip.entityLink}>{trip.entityName}</Link>
                    {trip.partner?.isRestricted && (
                      <div style={{ fontSize: "0.7rem", color: "#a6540f", fontWeight: 700 }}>
                        Restricted partner
                      </div>
                    )}
                  </td>
                  <td>{trip.entityType}</td>
                  <td>
                    {isHistorical ? (
                      <StatusBadge status={trip.status} />
                    ) : (
                      <Link to={`/admin/trips/${trip.id}`}>
                        <StatusBadge status={trip.status} />
                      </Link>
                    )}
                  </td>
                  <td>{trip.type || "—"}</td>
                  <td>
                    {trip.startDate || trip.endDate
                      ? `${formatDate(trip.startDate) || "?"} – ${formatDate(trip.endDate) || "?"}`
                      : "—"}
                  </td>
                  <td>{trip.size}</td>
                  <td>{leaders.length ? leaders.join(", ") : "—"}</td>
                  <td>{trip.description || "—"}</td>
                  <td className="table-actions">
                    {!isHistorical && (
                      <Link className="btn secondary small" to={`/admin/trips/${trip.id}`}>
                        View
                      </Link>
                    )}
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => (editingId === trip.id ? setEditingId(null) : startEdit(trip))}
                    >
                      {editingId === trip.id ? "Cancel" : "Edit"}
                    </button>
                    <button type="button" className="btn danger small" onClick={() => handleDelete(trip)}>
                      Delete
                    </button>
                  </td>
                </tr>
                {editingId === trip.id && (
                  <tr>
                    <td colSpan={9}>
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
              <td colSpan={9} style={{ color: "#888" }}>
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
