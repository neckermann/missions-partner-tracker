import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAdminMissionaries,
  fetchAdminOrganizations,
  createTrip,
  updateTrip,
  deleteTrip,
} from "../api/client.js";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";

// Date-only fields are stored as UTC midnight — build the Date from raw
// Y/M/D components (not new Date(isoString)) to avoid a timezone-shift
// off-by-one-day bug, matching the detail pages' formatDate.
function formatDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

// The API returns full ISO datetime strings for date-only columns --
// <input type="date"> needs exactly "YYYY-MM-DD". Same helper as
// AdminMissionaryForm.jsx's toDateInputValue.
function toDateInputValue(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function yearOf(value) {
  return value ? String(value).slice(0, 4) : null;
}

// Same list as AdminMissionaryForm.jsx's TRIP_TYPE_PRESETS -- kept as its
// own small copy rather than a shared import, same as this page's existing
// formatDate duplication across the admin pages.
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

const emptyParticipant = { name: "", role: "", isLeader: false, phone: "", email: "" };
const emptyTripForm = {
  entityKey: "",
  startDate: "",
  endDate: "",
  tripType: "",
  description: "",
  notes: "",
  participants: [],
};

const emptyFilters = {
  entityType: "all", // all | Missionary | Organization
  tripType: "all",
  year: "all",
  minSize: "",
  maxSize: "",
};

export default function AdminTripHistory() {
  const [missionaries, setMissionaries] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTrip, setNewTrip] = useState(emptyTripForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyTripForm);

  function reload() {
    fetchAdminMissionaries().then(setMissionaries).catch(console.error);
    fetchAdminOrganizations().then(setOrganizations).catch(console.error);
  }

  useEffect(() => {
    reload();
  }, []);

  function updateFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  // Flattens every trip (from every missionary and organization) into one
  // list with a common shape, so the rest of the page doesn't need to know
  // it's really two separate relations (missionTrips vs orgTrips).
  const trips = useMemo(() => {
    const fromMissionaries = missionaries.flatMap((m) =>
      (m.missionTrips || []).map((t) => ({
        ...t,
        entityType: "Missionary",
        entityName: m.displayName,
        entityLink: `/admin/missionaries/${m.id}`,
        size: (t.participants || []).length,
      }))
    );
    const fromOrgs = organizations.flatMap((o) =>
      (o.orgTrips || []).map((t) => ({
        ...t,
        entityType: "Organization",
        entityName: o.name,
        entityLink: `/admin/organizations/${o.id}`,
        size: (t.participants || []).length,
      }))
    );
    return [...fromMissionaries, ...fromOrgs].sort(
      (a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0)
    );
  }, [missionaries, organizations]);

  // Filter option lists are built from the trips actually on file (not a
  // hardcoded preset list), so a custom trip type someone typed in still
  // shows up as something you can filter by.
  const tripTypeOptions = useMemo(
    () => Array.from(new Set(trips.map((t) => t.tripType).filter(Boolean))).sort(),
    [trips]
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(trips.map((t) => yearOf(t.startDate)).filter(Boolean))).sort((a, b) => b - a),
    [trips]
  );

  const filteredTrips = trips.filter((t) => {
    if (filters.entityType !== "all" && t.entityType !== filters.entityType) return false;
    if (filters.tripType !== "all" && t.tripType !== filters.tripType) return false;
    if (filters.year !== "all" && yearOf(t.startDate) !== filters.year) return false;
    if (filters.minSize !== "" && t.size < Number(filters.minSize)) return false;
    if (filters.maxSize !== "" && t.size > Number(filters.maxSize)) return false;
    return true;
  });

  const totalParticipants = filteredTrips.reduce((sum, t) => sum + t.size, 0);

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
    return participants.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name);
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newTrip.entityKey) {
      setError("Choose a missionary or organization");
      return;
    }
    const [entityType, entityId] = newTrip.entityKey.split(":");
    setSaving(true);
    try {
      await createTrip({
        missionaryId: entityType === "missionary" ? entityId : null,
        organizationId: entityType === "organization" ? entityId : null,
        startDate: newTrip.startDate || null,
        endDate: newTrip.endDate || null,
        tripType: newTrip.tripType || null,
        description: newTrip.description || null,
        notes: newTrip.notes || null,
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
      entityKey: "",
      startDate: toDateInputValue(trip.startDate),
      endDate: toDateInputValue(trip.endDate),
      tripType: trip.tripType || "",
      description: trip.description || "",
      notes: trip.notes || "",
      participants: (trip.participants || []).map((p) => ({ ...p })),
    });
  }

  async function submitEdit(id) {
    setError("");
    try {
      await updateTrip(id, {
        startDate: editForm.startDate || null,
        endDate: editForm.endDate || null,
        tripType: editForm.tripType || null,
        description: editForm.description || null,
        notes: editForm.notes || null,
        participants: cleanParticipants(editForm.participants),
      });
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save trip");
    }
  }

  async function handleDelete(trip) {
    if (!confirm(`Delete this trip for ${trip.entityName}? This cannot be undone.`)) return;
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
                Name
                <input value={p.name} onChange={(e) => updateParticipant(which, pIndex, "name", e.target.value)} />
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
                <input value={p.phone || ""} onChange={(e) => updateParticipant(which, pIndex, "phone", e.target.value)} />
              </label>
              <label>
                Email
                <input value={p.email || ""} onChange={(e) => updateParticipant(which, pIndex, "email", e.target.value)} />
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
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Trip History</h2>
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

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              Missionary or Organization
              <select
                value={newTrip.entityKey}
                onChange={(e) => setNewTrip((f) => ({ ...f, entityKey: e.target.value }))}
                required
              >
                <option value="">Select one...</option>
                <optgroup label="Missionaries">
                  {missionaries.map((m) => (
                    <option key={m.id} value={`missionary:${m.id}`}>
                      {m.displayName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Organizations">
                  {organizations.map((o) => (
                    <option key={o.id} value={`organization:${o.id}`}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              </select>
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
                value={newTrip.tripType}
                onChange={(val) => setNewTrip((f) => ({ ...f, tripType: val }))}
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
            <textarea rows={2} value={newTrip.notes} onChange={(e) => setNewTrip((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          {renderParticipantsEditor("new", newTrip)}
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Save Trip"}
            </button>
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
            <select value={filters.tripType} onChange={(e) => updateFilter("tripType", e.target.value)}>
              <option value="all">All</option>
              {tripTypeOptions.map((type) => (
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
        <button type="button" className="btn secondary small" style={{ marginTop: "1rem" }} onClick={() => setFilters(emptyFilters)}>
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
            <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Total Participants</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{totalParticipants}</div>
          </div>
        </div>
      </div>

      <table className="admin-table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Partner</th>
            <th>Type</th>
            <th>Trip Type</th>
            <th>Dates</th>
            <th>Team Size</th>
            <th>Leader(s)</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredTrips.map((trip) => {
            const leaders = (trip.participants || []).filter((p) => p.isLeader).map((p) => p.name);
            return (
              <React.Fragment key={trip.id}>
                <tr>
                  <td>
                    <Link to={trip.entityLink}>{trip.entityName}</Link>
                  </td>
                  <td>{trip.entityType}</td>
                  <td>{trip.tripType || "—"}</td>
                  <td>
                    {trip.startDate || trip.endDate
                      ? `${formatDate(trip.startDate) || "?"} – ${formatDate(trip.endDate) || "?"}`
                      : "—"}
                  </td>
                  <td>{trip.size}</td>
                  <td>{leaders.length ? leaders.join(", ") : "—"}</td>
                  <td>{trip.description || "—"}</td>
                  <td className="table-actions">
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
                    <td colSpan={8}>
                      <div className="form-grid">
                        <label title="To move this trip to a different missionary/organization, delete it and add it again under the correct partner.">
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
                            value={editForm.tripType}
                            onChange={(val) => setEditForm((f) => ({ ...f, tripType: val }))}
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
                      {renderParticipantsEditor("edit", editForm)}
                      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
                      <div style={{ marginTop: "0.5rem" }}>
                        <button type="button" className="btn small" onClick={() => submitEdit(trip.id)}>
                          Save
                        </button>
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
    </div>
  );
}
