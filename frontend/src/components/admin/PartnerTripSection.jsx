import React, { useState } from "react";
import { createTrip, updateTrip, deleteTrip } from "../../api/client.js";
import PresetOrCustomSelect from "./PresetOrCustomSelect.jsx";
import AlbumLinkField from "./AlbumLinkField.jsx";
import { formatDate, toDateInputValue } from "../../utils/format.js";
import useLoadMore from "../../hooks/useLoadMore.js";
import LoadMoreButton from "../LoadMoreButton.jsx";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";

// Trips for one partner, on that partner's own page. Same records and same
// endpoints as the consolidated Trip History page -- this is just the view
// scoped to a single partner, the way prayer requests and newsletters
// already worked.

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
const emptyForm = {
  startDate: "",
  endDate: "",
  type: "",
  description: "",
  notes: "",
  albumProvider: null,
  albumUrl: null,
  participants: [],
};

export default function PartnerTripSection({ partnerId, trips, onChange }) {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { visible, hasMore, remaining, showMore } = useLoadMore(trips);

  function resetForm() {
    setForm(emptyForm);
    setShowAddForm(false);
    setEditingId(null);
    setError("");
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function addParticipant() {
    setForm((f) => ({ ...f, participants: [...f.participants, { ...emptyParticipant }] }));
  }
  function updateParticipant(index, field, value) {
    setForm((f) => {
      const next = [...f.participants];
      next[index] = { ...next[index], [field]: value };
      return { ...f, participants: next };
    });
  }
  function removeParticipant(index) {
    setForm((f) => ({ ...f, participants: f.participants.filter((_, i) => i !== index) }));
  }

  function startEdit(trip) {
    setEditingId(trip.id);
    setShowAddForm(false);
    setError("");
    setForm({
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

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      type: form.type || null,
      description: form.description || null,
      notes: form.notes || null,
      albumProvider: form.albumProvider || null,
      albumUrl: form.albumUrl || null,
      participants: form.participants
        .map((p) => ({ ...p, firstName: p.firstName.trim() }))
        .filter((p) => p.firstName),
    };
    try {
      if (editingId) await updateTrip(editingId, payload);
      else await createTrip({ partnerId, ...payload });
      resetForm();
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error?.[0]?.message || err.response?.data?.error || "Failed to save trip");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(trip) {
    const confirmed = await confirmDialog({
      title: "Delete this trip?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTrip(trip.id);
    await onChange();
  }

  const formOpen = showAddForm || editingId;

  return (
    <div className={`admin-section ${formOpen ? "form-has-floating-actions" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Trips</h3>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => (formOpen ? resetForm() : (setForm(emptyForm), setShowAddForm(true)))}
        >
          {formOpen ? "Cancel" : "+ Add Trip"}
        </button>
      </div>

      {formOpen && (
        <form onSubmit={submit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label>
              Start Date
              <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </label>
            <label>
              End Date
              <input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </label>
            <label>
              Trip Type
              <PresetOrCustomSelect
                value={form.type}
                onChange={(v) => set("type", v)}
                presets={TRIP_TYPE_PRESETS}
                placeholder="e.g. Photography"
              />
            </label>
          </div>
          <label style={{ marginTop: "0.75rem" }}>
            Description (what the team did)
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <label style={{ marginTop: "0.75rem" }}>
            Notes
            <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
          <label style={{ marginTop: "0.75rem" }}>
            Photo/Video Album
            <AlbumLinkField
              provider={form.albumProvider}
              url={form.albumUrl}
              onChange={(provider, url) => setForm((f) => ({ ...f, albumProvider: provider, albumUrl: url }))}
            />
          </label>

          <h4 style={{ marginTop: "1rem" }}>Participants</h4>
          {form.participants.map((p, i) => (
            <div className="repeatable-row" key={i} style={{ background: "white" }}>
              <button
                type="button"
                className="btn-remove"
                onClick={() => removeParticipant(i)}
                title="Remove"
              >
                ✕
              </button>
              <div className="form-grid">
                <label>
                  First Name
                  <input
                    value={p.firstName}
                    onChange={(e) => updateParticipant(i, "firstName", e.target.value)}
                  />
                </label>
                <label>
                  Last Name
                  <input
                    value={p.lastName || ""}
                    onChange={(e) => updateParticipant(i, "lastName", e.target.value)}
                  />
                </label>
                <label>
                  Role
                  <input
                    value={p.role || ""}
                    onChange={(e) => updateParticipant(i, "role", e.target.value)}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={p.phone || ""}
                    onChange={(e) => updateParticipant(i, "phone", e.target.value)}
                  />
                </label>
                <label>
                  Email
                  <input
                    value={p.email || ""}
                    onChange={(e) => updateParticipant(i, "email", e.target.value)}
                  />
                </label>
              </div>
              <div className="admin-checkbox-row" style={{ marginTop: "0.5rem" }}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!p.isLeader}
                    onChange={(e) => updateParticipant(i, "isLeader", e.target.checked)}
                  />
                  Trip Leader
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={addParticipant}>
            + Add Participant
          </button>

          <div className="form-save-bar">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save Trip" : "Add Trip"}
            </button>
            {error && (
              <span style={{ color: "#b91c1c" }} role="alert">
                {error}
              </span>
            )}
          </div>
        </form>
      )}

      <div style={{ marginTop: "1rem" }}>
        {trips?.length > 0 ? (
          visible.map((t) => {
            const leaders = (t.participants || [])
              .filter((p) => p.isLeader)
              .map((p) => [p.firstName, p.lastName].filter(Boolean).join(" "));
            return (
              <div key={t.id} className="repeatable-row">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <div>
                    <strong>{t.type || "Trip"}</strong>
                    <div style={{ fontSize: "0.85rem", color: "#666" }}>
                      {t.startDate || t.endDate
                        ? `${formatDate(t.startDate) || "?"} – ${formatDate(t.endDate) || "?"}`
                        : "Dates not recorded"}
                      {" · "}
                      {(t.participants || []).length} participant
                      {(t.participants || []).length === 1 ? "" : "s"}
                      {leaders.length ? ` · Led by ${leaders.join(", ")}` : ""}
                    </div>
                    {t.description && (
                      <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                        {t.description}
                      </div>
                    )}
                    {t.albumUrl && (
                      <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                        <a href={t.albumUrl} target="_blank" rel="noreferrer">
                          View Album
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="table-actions">
                    <button type="button" className="btn secondary small" onClick={() => startEdit(t)}>
                      Edit
                    </button>
                    <button type="button" className="btn danger small" onClick={() => handleDelete(t)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p style={{ color: "#888" }}>No trips on file.</p>
        )}
        <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} size="small" />
      </div>
      {confirmElement}
    </div>
  );
}
