import React, { useState } from "react";
import { createTrip, updateTrip, deleteTrip } from "../../api/client.js";
import TripFormFields, { emptyTripForm, cleanTripParticipants } from "./TripFormFields.jsx";
import { formatDate, toDateInputValue } from "../../utils/format.js";
import useLoadMore from "../../hooks/useLoadMore.js";
import LoadMoreButton from "../LoadMoreButton.jsx";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";

// Trips for one partner, on that partner's own page. Same records and same
// endpoints as the consolidated Trips page's "Existing Trips" tab -- this
// is just the view scoped to a single partner, the way prayer requests and
// newsletters already worked. Field set lives in TripFormFields.jsx (Phase
// 3b of the UX-rebuild plan), shared with that tab's own add/edit forms.

export default function PartnerTripSection({ partnerId, trips, onChange }) {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(emptyTripForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { visible, hasMore, remaining, showMore } = useLoadMore(trips);

  function resetForm() {
    setForm(emptyTripForm);
    setShowAddForm(false);
    setEditingId(null);
    setError("");
  }

  function startEdit(trip) {
    setEditingId(trip.id);
    setShowAddForm(false);
    setError("");
    setForm({
      ...emptyTripForm,
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
      participants: cleanTripParticipants(form.participants),
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
          onClick={() => (formOpen ? resetForm() : (setForm(emptyTripForm), setShowAddForm(true)))}
        >
          {formOpen ? "Cancel" : "+ Add Trip"}
        </button>
      </div>

      {formOpen && (
        <form onSubmit={submit} style={{ marginTop: "1rem" }}>
          <TripFormFields form={form} setForm={setForm} />
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
