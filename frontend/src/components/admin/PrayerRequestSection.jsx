import React, { useState } from "react";
import {
  createPrayerRequest,
  updatePrayerRequest,
  deletePrayerRequest,
  fetchUrgentRecipientCount,
} from "../../api/client.js";
import { formatDate, todayInputValue, toDateInputValue } from "../../utils/format.js";
import useLoadMore from "../../hooks/useLoadMore.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import useChurchSettings from "../../hooks/useChurchSettings.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import SourceLink from "./SourceLink.jsx";
import PrayerRequestFormFields from "./PrayerRequestFormFields.jsx";
import LoadMoreButton from "../LoadMoreButton.jsx";
import UrgentSendConfirmBody from "./UrgentSendConfirmBody.jsx";
import ApproveRestrictedTextConfirmBody from "./ApproveRestrictedTextConfirmBody.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";

const emptyNewRequest = {
  category: "strategic",
  requestText: "",
  dateReceived: todayInputValue(),
  isPublic: false,
  includeInBooklet: false,
  untracked: false,
  isUrgent: false,
  approveNow: false,
  notes: "",
  sourceFileId: null,
};

// Reused as-is on both AdminMissionaryDetail.jsx and
// AdminOrganizationDetail.jsx, same pattern as PartnerFileSection.jsx.
// Scoped to one partner via partnerId.
//
// Deliberately no status badge/coloring for "ongoing" or "untracked"
// requests — see the PrayerRequest model comment in schema.prisma for
// why: an open request isn't a problem to flag, it's just still open.
// The only status this UI calls out at all is "answered", as a quiet
// note, not a checklist item being marked off.
export default function PrayerRequestSection({ partnerId, isRestricted, prayerRequests, files, onChange }) {
  const { enabledFeatures } = useSettings();
  // Whether any channel exists at all to ever deliver a recorded event --
  // shared precondition for "Mark as urgent" below (nothing to
  // broadcast urgently to otherwise, so the option isn't offered rather
  // than silently doing nothing) and for "Review and approve now"
  // (approving just clears the review hold; that's equally pointless if
  // nothing would ever pick the row up once cleared). Named for what it
  // actually checks, not for either specific checkbox that happens to
  // depend on it -- calling this "canSendUrgent" while also using it to
  // gate approve-now was confusing, since approving isn't about urgent
  // sending at all.
  const hasEnabledChannel =
    enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail;
  // "Approve now" additionally requires allowRestrictedPartnerDispatch
  // -- when that's off, createDispatchRecord drops a restricted partner's
  // event before it's ever queued (see dispatchRecording.js), so checking
  // this box would silently do nothing. Defaults to true while loading --
  // a UI convenience gate only, so briefly over-showing the control is
  // harmless; the real check is still enforced server-side regardless.
  const { settings } = useChurchSettings();
  const allowRestrictedPartnerDispatch = settings?.allowRestrictedPartnerDispatch !== false;
  const canApproveNow = isRestricted && hasEnabledChannel && allowRestrictedPartnerDispatch;
  // Named confirmDialog, not confirm -- this file's only confirmation
  // surface now (approve-now, urgent-send, and delete all route through
  // it), and `confirm` would read as a reference to the native global
  // this hook replaces.
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRequest, setNewRequest] = useState(emptyNewRequest);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answeringId, setAnsweringId] = useState(null);
  const [answer, setAnswer] = useState({ dateAnswered: todayInputValue(), answeredNote: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const { visible, hasMore, remaining, showMore } = useLoadMore(prayerRequests);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newRequest.approveNow) {
      const text = newRequest.requestText.trim();
      const approved = await confirmDialog({
        title: "Approve and send now?",
        body: <ApproveRestrictedTextConfirmBody text={text} />,
        confirmLabel: "Approve and save",
      });
      if (!approved) return;
    }
    if (newRequest.isUrgent) {
      const { adminCount, publicCount } = await fetchUrgentRecipientCount(partnerId);
      const sent = await confirmDialog({
        title: "Send now?",
        body: (
          <UrgentSendConfirmBody
            enabledFeatures={enabledFeatures}
            adminCount={adminCount}
            publicCount={publicCount}
          />
        ),
        confirmLabel: "Send now",
      });
      if (!sent) return;
    }
    setSaving(true);
    try {
      const isStrategic = newRequest.category === "strategic";
      await createPrayerRequest({
        partnerId,
        category: newRequest.category,
        requestText: newRequest.requestText.trim(),
        dateReceived: newRequest.dateReceived,
        isPublic: isStrategic ? newRequest.isPublic : false,
        includeInBooklet: isStrategic && newRequest.isPublic ? newRequest.includeInBooklet : false,
        status: newRequest.untracked ? "untracked" : "ongoing",
        isUrgent: newRequest.isUrgent,
        approveNow: newRequest.approveNow,
        notes: newRequest.notes || null,
        sourceFileId: newRequest.sourceFileId,
      });
      setNewRequest(emptyNewRequest);
      setShowAddForm(false);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add prayer request");
    } finally {
      setSaving(false);
    }
  }

  function startAnswer(request) {
    setAnsweringId(request.id);
    setAnswer({ dateAnswered: todayInputValue(), answeredNote: "" });
  }

  async function submitAnswer(id) {
    try {
      await updatePrayerRequest(id, {
        status: "answered",
        dateAnswered: answer.dateAnswered,
        answeredNote: answer.answeredNote || null,
      });
      setAnsweringId(null);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to record the answer");
    }
  }

  async function handleDelete(request) {
    const confirmed = await confirmDialog({
      title: "Delete this prayer request?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deletePrayerRequest(request.id);
    await onChange();
  }

  // Same scope boundary as AdminPrayerRequests.jsx -- deliberately doesn't
  // touch status/dateAnswered/answeredNote, which stays exclusively the
  // Record Answer flow's job.
  function startEdit(request) {
    setEditingId(request.id);
    setEditForm({
      category: request.category,
      requestText: request.requestText,
      dateReceived: toDateInputValue(request.dateReceived),
      isPublic: request.isPublic,
      includeInBooklet: request.includeInBooklet,
      notes: request.notes || "",
      sourceFileId: request.sourceFile?.id || null,
    });
  }

  async function submitEdit(id) {
    const isStrategic = editForm.category === "strategic";
    try {
      await updatePrayerRequest(id, {
        category: editForm.category,
        requestText: editForm.requestText.trim(),
        dateReceived: editForm.dateReceived,
        isPublic: isStrategic ? editForm.isPublic : false,
        includeInBooklet: isStrategic && editForm.isPublic ? editForm.includeInBooklet : false,
        notes: editForm.notes || null,
        sourceFileId: editForm.sourceFileId,
      });
      setEditingId(null);
      setEditForm(null);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save changes");
    }
  }

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ flex: 1, marginBottom: 0 }}>Prayer Requests</h3>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => (setShowAddForm((v) => !v), setError(""))}
        >
          {showAddForm ? "Cancel" : "+ Add Prayer Request"}
        </button>
      </div>

      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {showAddForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <PrayerRequestFormFields
            form={newRequest}
            setForm={setNewRequest}
            files={files}
            mode="create"
            hasEnabledChannel={hasEnabledChannel}
            canApproveNow={canApproveNow}
            enabledFeatures={enabledFeatures}
          />
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "Saving..." : "Add Prayer Request"}
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: "1rem" }}>
        {prayerRequests?.length > 0 ? (
          visible.map((p) => (
            <div key={p.id} className="repeatable-row">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                {editingId === p.id ? (
                  <div style={{ flex: 1 }}>
                    <PrayerRequestFormFields
                      form={editForm}
                      setForm={setEditForm}
                      files={files}
                      mode="edit"
                    />
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                      <button type="button" className="btn small" onClick={() => submitEdit(p.id)}>
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => {
                          setEditingId(null);
                          setEditForm(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p style={{ margin: 0 }}>{p.requestText}</p>
                    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                      Received {formatDate(p.dateReceived)} ·{" "}
                      {p.category === "strategic" ? "Strategic" : "Situational"}
                      {p.category === "strategic" && p.isPublic && " · Public"}
                      {p.category === "strategic" && p.isPublic && p.includeInBooklet && " · In booklet"}
                    </div>
                    <SourceLink sourceFile={p.sourceFile} />
                    {/* The only status ever called out here is "answered" -- an
                        "ongoing" or "untracked" request just shows nothing
                        extra, matching this feature's whole design intent. */}
                    {p.status === "answered" && (
                      <div style={{ fontSize: "0.85rem", color: "#2a5d3c", marginTop: "0.4rem" }}>
                        ✓ Answered {formatDate(p.dateAnswered)}
                        {p.answeredNote && ` — ${p.answeredNote}`}
                      </div>
                    )}
                    {p.notes && (
                      <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                        {p.notes}
                      </div>
                    )}
                  </div>
                )}
                <div className="table-actions">
                  <button type="button" className="btn secondary small" onClick={() => startEdit(p)}>
                    Edit
                  </button>
                  {p.status !== "answered" && (
                    <button type="button" className="btn secondary small" onClick={() => startAnswer(p)}>
                      Record Answer
                    </button>
                  )}
                  <button type="button" className="btn danger small" onClick={() => handleDelete(p)}>
                    Delete
                  </button>
                </div>
              </div>

              {answeringId === p.id && (
                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "flex-end",
                    flexWrap: "wrap",
                    marginTop: "0.75rem",
                  }}
                >
                  <label>
                    Date Answered
                    <input
                      type="date"
                      value={answer.dateAnswered}
                      onChange={(e) => setAnswer((a) => ({ ...a, dateAnswered: e.target.value }))}
                    />
                  </label>
                  <label style={{ flex: 1, minWidth: "200px" }}>
                    How was it answered? (optional)
                    <input
                      value={answer.answeredNote}
                      onChange={(e) => setAnswer((a) => ({ ...a, answeredNote: e.target.value }))}
                      placeholder="e.g. The clinic opened safely in March"
                    />
                  </label>
                  <button type="button" className="btn small" onClick={() => submitAnswer(p.id)}>
                    Save
                  </button>
                  <button type="button" className="btn secondary small" onClick={() => setAnsweringId(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p style={{ color: "#888" }}>No prayer requests on file.</p>
        )}
        <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} size="small" />
      </div>
      {confirmElement}
    </div>
  );
}
