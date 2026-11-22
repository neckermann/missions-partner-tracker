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
import RecordList from "../components/admin/RecordList.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Field from "../components/admin/Field.jsx";

const KIND_LABELS = { task: "Task", esignature: "E-signature", document: "Document" };

const emptyRequirementForm = {
  label: "",
  kind: "document",
  bodyText: "",
  dueAt: "",
  reminderLeadDays: "",
  minorsOnly: false,
};

// Converted from onBlur-autosave onto click-row-opens-popup, same as
// AdminTripMeetings.jsx -- label/kind are fixed at creation (never were
// editable after the fact in the old inline form either), so the edit
// popup shows them as plain read-only context and only the fields that
// were genuinely editable (due date, reminder lead time, minors-only,
// the e-signature agreement text) become form inputs.
export default function AdminTripRequirements() {
  const { trip, reload, requirementLibrary, confirmDialog, canWrite } = useOutletContext();
  const [error, setError] = useState("");
  const [requirementLibraryPick, setRequirementLibraryPick] = useState("");
  const [tripWideFile, setTripWideFile] = useState(null);
  const [tripWideTitle, setTripWideTitle] = useState("");
  const [reqModal, setReqModal] = useState(null); // null | { id: null|reqId, form }

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  function openAddRequirement() {
    setReqModal({ id: null, form: emptyRequirementForm });
  }

  function openEditRequirement(r) {
    setReqModal({
      id: r.id,
      label: r.label,
      kind: r.kind,
      form: {
        bodyText: r.bodyText || "",
        dueAt: r.dueAt ? r.dueAt.slice(0, 10) : "",
        reminderLeadDays: r.reminderLeadDays || "",
        minorsOnly: !!r.minorsOnly,
      },
    });
  }

  function setReqModalForm(updater) {
    setReqModal((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitReqModal() {
    if (reqModal.id == null) {
      if (!reqModal.form.label.trim()) throw new Error("Enter a label");
      await addTripRequirement(trip.id, {
        label: reqModal.form.label.trim(),
        kind: reqModal.form.kind,
        bodyText: reqModal.form.kind === "esignature" ? reqModal.form.bodyText.trim() || null : null,
        dueAt: reqModal.form.dueAt || null,
        minorsOnly: reqModal.form.minorsOnly,
      });
    } else {
      await updateTripRequirement(reqModal.id, {
        dueAt: reqModal.form.dueAt || null,
        reminderLeadDays: reqModal.form.reminderLeadDays ? Number(reqModal.form.reminderLeadDays) : null,
        minorsOnly: reqModal.form.minorsOnly,
        ...(reqModal.kind === "esignature" ? { bodyText: reqModal.form.bodyText } : {}),
      });
    }
    reload();
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

  async function handleDeleteRequirement(r) {
    const confirmed = await confirmDialog({
      title: "Remove this requirement?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripRequirement(r.id);
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

  const tripWideDocs = (trip.documents || []).filter((d) => !d.participantId);

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
        {canWrite && requirementLibrary.length > 0 && (
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
        <RecordList
          bare
          items={trip.requirements || []}
          canEdit={canWrite}
          canDelete={canWrite}
          onAdd={openAddRequirement}
          onEdit={openEditRequirement}
          onDelete={handleDeleteRequirement}
          emptyMessage="No requirements yet."
          renderItem={(r) => {
            const overdue = r.dueAt && new Date(r.dueAt) < new Date();
            return (
              <>
                <Field label="Kind" value={KIND_LABELS[r.kind] || r.kind} />
                <Field label="Label" value={r.label} />
                <Field label="Due" value={overdue ? `${r.dueAt.slice(0, 10)} (overdue)` : r.dueAt?.slice(0, 10)} showEmpty />
                <Field label="Minors only" value={r.minorsOnly ? "Yes" : "No"} />
              </>
            );
          }}
        />
      </div>

      <div className="admin-section">
        <h3>Trip-wide documents</h3>
        <p style={{ color: "#888", fontSize: "0.85rem" }}>
          Shared with the whole team -- an itinerary, packing list, or anything else that isn't specific to
          one person.
        </p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {tripWideDocs.map((d) => (
            <li key={d.id} style={{ marginBottom: "0.3rem" }}>
              {d.title || d.fileName}
              {d.fileSize != null && (
                <span style={{ color: "#888", fontSize: "0.8rem" }}> ({formatFileSize(d.fileSize)})</span>
              )}{" "}
              <button type="button" className="btn secondary small" onClick={() => handleViewDocument(d)}>
                View
              </button>{" "}
              {canWrite && (
                <button type="button" className="btn-remove" onClick={() => handleDeleteDocument(d.id)}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {tripWideDocs.length === 0 && <p style={{ color: "#888" }}>No trip-wide documents yet.</p>}
        </ul>
        {canWrite && (
          <>
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
            <button
              type="button"
              className="btn secondary small"
              disabled={!tripWideFile}
              onClick={handleUploadTripWideDocument}
            >
              Upload
            </button>
          </>
        )}
      </div>

      {reqModal && canWrite && (
        <QuickActionModal
          title={reqModal.id == null ? "Add Requirement" : "Edit Requirement"}
          onClose={() => setReqModal(null)}
          onSubmit={submitReqModal}
        >
          {reqModal.id == null ? (
            <div className="form-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                Label
                <input
                  value={reqModal.form.label}
                  onChange={(e) => setReqModalForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Signed Waiver, or Attended orientation call"
                  required
                />
              </label>
              <label>
                Kind
                <select
                  value={reqModal.form.kind}
                  onChange={(e) => setReqModalForm((f) => ({ ...f, kind: e.target.value }))}
                >
                  <option value="document">Document</option>
                  <option value="task">Task</option>
                  <option value="esignature">E-signature</option>
                </select>
              </label>
              <label>
                Due (optional)
                <input
                  type="date"
                  value={reqModal.form.dueAt}
                  onChange={(e) => setReqModalForm((f) => ({ ...f, dueAt: e.target.value }))}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <input
                  type="checkbox"
                  checked={reqModal.form.minorsOnly}
                  onChange={(e) => setReqModalForm((f) => ({ ...f, minorsOnly: e.target.checked }))}
                />
                Minors only
              </label>
              {reqModal.form.kind === "esignature" && (
                <label style={{ gridColumn: "1 / -1" }}>
                  Agreement text (shown to the participant before they sign)
                  <textarea
                    rows={3}
                    value={reqModal.form.bodyText}
                    onChange={(e) => setReqModalForm((f) => ({ ...f, bodyText: e.target.value }))}
                  />
                </label>
              )}
            </div>
          ) : (
            <div className="form-grid">
              <Field label="Kind" value={KIND_LABELS[reqModal.kind] || reqModal.kind} />
              <Field label="Label" value={reqModal.label} />
              <label>
                Due
                <input
                  type="date"
                  value={reqModal.form.dueAt}
                  onChange={(e) => setReqModalForm((f) => ({ ...f, dueAt: e.target.value }))}
                />
              </label>
              {reqModal.form.dueAt && (
                <label>
                  Remind (days before)
                  <input
                    type="number"
                    min="1"
                    value={reqModal.form.reminderLeadDays}
                    onChange={(e) => setReqModalForm((f) => ({ ...f, reminderLeadDays: e.target.value }))}
                  />
                </label>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <input
                  type="checkbox"
                  checked={reqModal.form.minorsOnly}
                  onChange={(e) => setReqModalForm((f) => ({ ...f, minorsOnly: e.target.checked }))}
                />
                Minors only
              </label>
              {reqModal.kind === "esignature" && (
                <label style={{ gridColumn: "1 / -1" }}>
                  Agreement text (shown to the participant before they sign)
                  <textarea
                    rows={3}
                    value={reqModal.form.bodyText}
                    onChange={(e) => setReqModalForm((f) => ({ ...f, bodyText: e.target.value }))}
                  />
                </label>
              )}
            </div>
          )}
        </QuickActionModal>
      )}
    </div>
  );
}
