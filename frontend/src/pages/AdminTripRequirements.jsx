import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  addTripRequirement,
  updateTripRequirement,
  deleteTripRequirement,
  uploadTripDocument,
  deleteTripDocument,
} from "../api/client.js";
import { formatFileSize } from "../utils/format.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

export default function AdminTripRequirements() {
  const { trip, reload, requirementLibrary, confirmDialog } = useOutletContext();
  const [error, setError] = useState("");
  const [newRequirement, setNewRequirement] = useState({
    label: "",
    kind: "document",
    bodyText: "",
    dueAt: "",
    reminderLeadDays: "",
    minorsOnly: false,
  });
  const [requirementLibraryPick, setRequirementLibraryPick] = useState("");
  const [tripWideFile, setTripWideFile] = useState(null);
  const [tripWideTitle, setTripWideTitle] = useState("");

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  async function handleAddRequirement(e) {
    e.preventDefault();
    if (!newRequirement.label.trim()) return;
    try {
      await addTripRequirement(trip.id, {
        label: newRequirement.label.trim(),
        kind: newRequirement.kind,
        bodyText: newRequirement.kind === "esignature" ? newRequirement.bodyText.trim() || null : null,
        dueAt: newRequirement.dueAt || null,
        reminderLeadDays: newRequirement.reminderLeadDays ? Number(newRequirement.reminderLeadDays) : null,
        minorsOnly: newRequirement.minorsOnly,
      });
      setNewRequirement({
        label: "",
        kind: "document",
        bodyText: "",
        dueAt: "",
        reminderLeadDays: "",
        minorsOnly: false,
      });
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't add this requirement.");
    }
  }

  async function handleAddRequirementFromLibrary() {
    if (!requirementLibraryPick) return;
    const entry = requirementLibrary.find((r) => r.id === requirementLibraryPick);
    if (!entry) return;
    try {
      await addTripRequirement(trip.id, {
        label: entry.label,
        kind: entry.kind,
        bodyText: entry.bodyText || null,
        reminderLeadDays: entry.reminderLeadDays || null,
        minorsOnly: entry.minorsOnly || false,
      });
      setRequirementLibraryPick("");
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't add that requirement.");
    }
  }

  async function updateReq(reqId, patch) {
    try {
      await updateTripRequirement(reqId, patch);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't save that change.");
    }
  }

  async function handleDeleteRequirement(reqId) {
    const confirmed = await confirmDialog({
      title: "Remove this requirement?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripRequirement(reqId);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't remove this requirement.");
    }
  }

  async function handleUploadTripWideDocument() {
    if (!tripWideFile) return;
    try {
      await uploadTripDocument(trip.id, tripWideFile, { title: tripWideTitle.trim() || undefined });
      setTripWideFile(null);
      setTripWideTitle("");
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't upload this document.");
    }
  }

  function handleViewDocument(doc) {
    window.open(`/api/trips/documents/${doc.id}/download`, "_blank");
  }

  async function handleDeleteDocument(docId) {
    const confirmed = await confirmDialog({
      title: "Remove this document?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripDocument(docId);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't remove this document.");
    }
  }

  return (
    <div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-section">
        <h3>Trip Requirements</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          What this trip needs from each participant -- a document to upload, or a plain task an admin checks
          off (e.g. "Attended orientation call"). Give one a due date to see it flagged once overdue; add a
          reminder lead time to have anyone who hasn't fulfilled it emailed automatically before it's due.
        </p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {(trip.requirements || []).map((r) => {
            const overdue = r.dueAt && new Date(r.dueAt) < new Date();
            return (
              <li
                key={r.id}
                style={{ border: "1px solid #e1dfdb", borderRadius: 6, padding: "0.5rem 0.6rem", marginBottom: "0.5rem" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      color: r.kind === "task" ? "#2a5d8f" : r.kind === "esignature" ? "#a6540f" : "#1f6b4f",
                      background: r.kind === "task" ? "#e8eff7" : r.kind === "esignature" ? "#fbeee0" : "#e7f3ee",
                    }}
                  >
                    {r.kind === "task" ? "Task" : r.kind === "esignature" ? "E-signature" : "Document"}
                  </span>
                  <strong style={{ flex: 1 }}>{r.label}</strong>
                  <label style={{ fontWeight: 400, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <input
                      type="checkbox"
                      checked={!!r.minorsOnly}
                      onChange={(e) => updateReq(r.id, { minorsOnly: e.target.checked })}
                    />
                    Minors only
                  </label>
                  <label style={{ fontWeight: 400, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    Due
                    <input
                      type="date"
                      defaultValue={r.dueAt ? r.dueAt.slice(0, 10) : ""}
                      onBlur={(e) => updateReq(r.id, { dueAt: e.target.value || null })}
                      style={{ width: "9.5rem" }}
                    />
                  </label>
                  {r.dueAt && (
                    <label style={{ fontWeight: 400, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      Remind
                      <input
                        type="number"
                        min="1"
                        placeholder="days before"
                        defaultValue={r.reminderLeadDays || ""}
                        onBlur={(e) =>
                          updateReq(r.id, { reminderLeadDays: e.target.value ? Number(e.target.value) : null })
                        }
                        style={{ width: "6rem" }}
                      />
                    </label>
                  )}
                  {overdue && <span style={{ color: "#b91c1c", fontSize: "0.75rem", fontWeight: 600 }}>Overdue</span>}
                  <button type="button" className="btn-remove" onClick={() => handleDeleteRequirement(r.id)}>
                    ✕
                  </button>
                </div>
                {r.kind === "esignature" && (
                  <label style={{ display: "block", marginTop: "0.5rem", fontWeight: 400, fontSize: "0.8rem" }}>
                    Agreement text (shown to the participant before they sign)
                    <textarea
                      rows={4}
                      defaultValue={r.bodyText || ""}
                      onBlur={(e) =>
                        e.target.value !== (r.bodyText || "") && updateReq(r.id, { bodyText: e.target.value })
                      }
                    />
                  </label>
                )}
              </li>
            );
          })}
          {(trip.requirements || []).length === 0 && <p style={{ color: "#888" }}>No requirements yet.</p>}
        </ul>
        {requirementLibrary.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
            <select
              style={{ flex: 1, minWidth: 220 }}
              value={requirementLibraryPick}
              onChange={(e) => setRequirementLibraryPick(e.target.value)}
            >
              <option value="">Add from your saved requirements...</option>
              {requirementLibrary.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn secondary small"
              onClick={handleAddRequirementFromLibrary}
              disabled={!requirementLibraryPick}
            >
              + Add to this trip
            </button>
          </div>
        )}
        <form onSubmit={handleAddRequirement} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            value={newRequirement.label}
            onChange={(e) => setNewRequirement((f) => ({ ...f, label: e.target.value }))}
            placeholder="e.g. Signed Waiver, or Attended orientation call"
          />
          <select value={newRequirement.kind} onChange={(e) => setNewRequirement((f) => ({ ...f, kind: e.target.value }))}>
            <option value="document">Document</option>
            <option value="task">Task</option>
            <option value="esignature">E-signature</option>
          </select>
          {newRequirement.kind === "esignature" && (
            <textarea
              style={{ flex: "1 1 100%", minWidth: 220 }}
              rows={3}
              placeholder="Agreement text the participant will sign"
              value={newRequirement.bodyText}
              onChange={(e) => setNewRequirement((f) => ({ ...f, bodyText: e.target.value }))}
            />
          )}
          <label style={{ fontWeight: 400, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
            Due (optional)
            <input type="date" value={newRequirement.dueAt} onChange={(e) => setNewRequirement((f) => ({ ...f, dueAt: e.target.value }))} />
          </label>
          <label style={{ fontWeight: 400, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <input
              type="checkbox"
              checked={newRequirement.minorsOnly}
              onChange={(e) => setNewRequirement((f) => ({ ...f, minorsOnly: e.target.checked }))}
            />
            Minors only
          </label>
          <button type="submit" className="btn secondary small">
            + Add
          </button>
        </form>
      </div>

      <div className="admin-section">
        <h3>Trip-wide documents</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Shared with the whole team -- an itinerary, packing list, or anything else that isn't specific to one
          person.
        </p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {(trip.documents || [])
            .filter((d) => !d.participantId)
            .map((d) => (
              <li key={d.id} style={{ marginBottom: "0.3rem" }}>
                {d.title || d.fileName}
                {d.fileSize != null && (
                  <span style={{ color: "#888", fontSize: "0.8rem" }}> ({formatFileSize(d.fileSize)})</span>
                )}{" "}
                <button type="button" className="btn secondary small" onClick={() => handleViewDocument(d)}>
                  View
                </button>{" "}
                <button type="button" className="btn-remove" onClick={() => handleDeleteDocument(d.id)}>
                  ✕
                </button>
              </li>
            ))}
          {(trip.documents || []).filter((d) => !d.participantId).length === 0 && (
            <p style={{ color: "#888" }}>No trip-wide documents yet.</p>
          )}
        </ul>
        <label style={{ display: "block", maxWidth: 300, fontWeight: 400, fontSize: "0.85rem" }}>
          Title (optional)
          <input
            type="text"
            placeholder="e.g. Packing list"
            value={tripWideTitle}
            onChange={(e) => setTripWideTitle(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: "0.2rem" }}
          />
        </label>
        <input
          type="file"
          aria-label="Trip-wide document file"
          style={{ marginTop: "0.5rem" }}
          onChange={(e) => setTripWideFile(e.target.files[0] || null)}
        />
        <button type="button" className="btn secondary small" disabled={!tripWideFile} onClick={handleUploadTripWideDocument}>
          Upload
        </button>
      </div>
    </div>
  );
}
