import React, { useCallback, useEffect, useState } from "react";
import {
  listSavedViews,
  createSavedView,
  deleteSavedView,
  createReportSchedule,
  deleteReportSchedule,
  fetchUsers,
} from "../../api/client.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import { mapServerErrorMessage } from "../../utils/friendlyError.js";

function friendlyError(err, fallback) {
  const raw = err?.response?.data?.error;
  return typeof raw === "string" ? mapServerErrorMessage(raw) : fallback;
}

// Saved views for one report: apply, save the current filters, delete, and
// (admins only) email a view to other users on a cadence. A scheduled
// email is always masked for restricted partners -- see
// backend/src/utils/reportScheduler.js. Reports never edit data; this only
// stores filter settings.
const CADENCES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

export default function SavedViewsBar({ reportId, queryValues, onApply, isAdmin }) {
  const [views, setViews] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [scheduling, setScheduling] = useState(null); // a view being scheduled
  const [users, setUsers] = useState([]);
  const [cadence, setCadence] = useState("monthly");
  const [recipientIds, setRecipientIds] = useState([]);
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  const load = useCallback(() => {
    listSavedViews(reportId)
      .then(setViews)
      .catch(() => setError("Couldn't load saved views."));
  }, [reportId]);
  useEffect(load, [load]);

  async function save(e) {
    e.preventDefault();
    setError("");
    try {
      await createSavedView({ reportId, name, params: queryValues, shared });
      setName("");
      setShared(false);
      setSaving(false);
      load();
    } catch (err) {
      setError(friendlyError(err, "Couldn't save the view."));
    }
  }

  async function remove(view) {
    const ok = await confirmDialog({
      title: "Delete saved view?",
      body: `"${view.name}" and any email schedule on it will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSavedView(view.id);
      load();
    } catch (err) {
      setError(friendlyError(err, "Couldn't delete the view."));
    }
  }

  async function startSchedule(view) {
    setScheduling(view);
    setRecipientIds([]);
    if (users.length === 0) {
      try {
        setUsers((await fetchUsers()).filter((u) => u.active && u.role !== "tripLeader"));
      } catch {
        setError("Couldn't load users.");
      }
    }
  }

  async function saveSchedule(e) {
    e.preventDefault();
    setError("");
    try {
      await createReportSchedule(scheduling.id, { cadence, recipientIds });
      setScheduling(null);
      load();
    } catch (err) {
      setError(friendlyError(err, "Couldn't create the schedule."));
    }
  }

  async function removeSchedule(id) {
    try {
      await deleteReportSchedule(id);
      load();
    } catch (err) {
      setError(friendlyError(err, "Couldn't remove the schedule."));
    }
  }

  return (
    <div className="admin-section no-print">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <strong>Saved views</strong>
        {views.length === 0 && <span style={{ color: "var(--muted)" }}>None yet.</span>}
        {views.map((v) => (
          <span key={v.id} className="recent-chip" style={{ display: "inline-flex", gap: "0.35rem" }}>
            <button type="button" className="summary-item-link" onClick={() => onApply(v.params)}>
              {v.name}
              {v.shared ? " (shared)" : ""}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="summary-item-link"
                onClick={() => startSchedule(v)}
                aria-label={`Email ${v.name}`}
                title="Email this view on a schedule"
              >
                ✉
              </button>
            )}
            <button
              type="button"
              className="summary-item-link"
              onClick={() => remove(v)}
              aria-label={`Delete ${v.name}`}
            >
              ✕
            </button>
          </span>
        ))}
        {!saving && (
          <button type="button" className="btn secondary small" onClick={() => setSaving(true)}>
            Save current filters
          </button>
        )}
      </div>

      {saving && (
        <form
          onSubmit={save}
          style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </label>
          <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              style={{ width: "auto" }}
            />
            Share with other staff
          </label>
          <button type="submit" className="btn small">
            Save
          </button>
          <button type="button" className="btn secondary small" onClick={() => setSaving(false)}>
            Cancel
          </button>
        </form>
      )}

      {views.some((v) => v.schedules?.length > 0) && (
        <ul style={{ margin: "0.75rem 0 0", paddingLeft: "1.2rem" }}>
          {views.flatMap((v) =>
            (v.schedules || []).map((s) => (
              <li key={s.id}>
                {v.name}: emailed {s.cadence} to {s.recipientIds.length}{" "}
                {s.recipientIds.length === 1 ? "person" : "people"}{" "}
                {isAdmin && (
                  <button type="button" className="summary-item-link" onClick={() => removeSchedule(s.id)}>
                    Stop
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}

      {scheduling && (
        <form onSubmit={saveSchedule} style={{ marginTop: "0.75rem" }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            Email <strong>{scheduling.name}</strong>. Restricted partners are masked in every scheduled email.
          </p>
          <label>
            How often
            <select value={cadence} onChange={(e) => setCadence(e.target.value)}>
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset style={{ margin: "0.5rem 0", border: "none", padding: 0 }}>
            <legend>Send to</legend>
            {users.map((u) => (
              <label key={u.id} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={recipientIds.includes(u.id)}
                  onChange={(e) =>
                    setRecipientIds((ids) =>
                      e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id)
                    )
                  }
                />
                {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn small" disabled={recipientIds.length === 0}>
            Start emailing
          </button>{" "}
          <button type="button" className="btn secondary small" onClick={() => setScheduling(null)}>
            Cancel
          </button>
        </form>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {confirmElement}
    </div>
  );
}
