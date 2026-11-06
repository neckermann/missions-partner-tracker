import React, { useState } from "react";
import {
  createPrayerRequest,
  updatePrayerRequest,
  deletePrayerRequest,
  fetchUrgentRecipientCount,
} from "../../api/client.js";
import { formatDate, todayInputValue, toDateInputValue } from "../../utils/format.js";
import { urgentSendDescription } from "../../utils/urgentSend.js";
import useLoadMore from "../../hooks/useLoadMore.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import useAllowRestrictedPartnerNotifications from "../../hooks/useAllowRestrictedPartnerNotifications.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import SourceLink from "./SourceLink.jsx";
import SourcePicker from "./SourcePicker.jsx";
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
  const hasEnabledChannel = enabledFeatures.groupme || enabledFeatures.outboundEmail;
  // "Approve now" additionally requires allowRestrictedPartnerNotifications
  // -- when that's off, recordEvent drops a restricted partner's event
  // before it's ever queued (see notificationRecording.js), so checking
  // this box would silently do nothing.
  const allowRestrictedPartnerNotifications = useAllowRestrictedPartnerNotifications();
  const canApproveNow = isRestricted && hasEnabledChannel && allowRestrictedPartnerNotifications;
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
          <UrgentSendConfirmBody enabledFeatures={enabledFeatures} adminCount={adminCount} publicCount={publicCount} />
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
      alert(err.response?.data?.error || "Failed to record the answer");
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
      alert(err.response?.data?.error || "Failed to save changes");
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

      {showAddForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label>
              Category
              <select
                value={newRequest.category}
                onChange={(e) => setNewRequest((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="strategic">
                  Strategic (ministry vision/calling — can be shared publicly)
                </option>
                <option value="situational">
                  Situational (health, travel, family, logistics — admin-only)
                </option>
              </select>
            </label>
            <label>
              Date Received
              <input
                type="date"
                value={newRequest.dateReceived}
                onChange={(e) => setNewRequest((f) => ({ ...f, dateReceived: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Prayer Request
              <textarea
                rows={2}
                value={newRequest.requestText}
                onChange={(e) => setNewRequest((f) => ({ ...f, requestText: e.target.value }))}
                required
              />
            </label>
            {newRequest.category === "strategic" && (
              <div className="admin-checkbox-row">
                <label title="Shows on this partner's public profile page, if the public site is enabled.">
                  <input
                    type="checkbox"
                    checked={newRequest.isPublic}
                    onChange={(e) =>
                      setNewRequest((f) => ({
                        ...f,
                        isPublic: e.target.checked,
                        includeInBooklet: e.target.checked && f.includeInBooklet,
                      }))
                    }
                  />
                  Show on public profile
                </label>
                {newRequest.isPublic && (
                  <label title="Eligible to print in the booklet -- the actual number shown per partner is capped there (see the Booklet page) so this section doesn't take over the page.">
                    <input
                      type="checkbox"
                      checked={newRequest.includeInBooklet}
                      onChange={(e) => setNewRequest((f) => ({ ...f, includeInBooklet: e.target.checked }))}
                    />
                    Include in printed booklet
                  </label>
                )}
              </div>
            )}
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={newRequest.untracked}
                  onChange={(e) => setNewRequest((f) => ({ ...f, untracked: e.target.checked }))}
                />
                Not tracking this one for a specific answer
              </label>
            </div>
            {hasEnabledChannel && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div className="admin-checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={newRequest.isUrgent}
                      onChange={(e) => setNewRequest((f) => ({ ...f, isUrgent: e.target.checked }))}
                    />
                    Mark as urgent -- send right away
                  </label>
                </div>
                <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
                  {urgentSendDescription(enabledFeatures)}
                </p>
              </div>
            )}
            {canApproveNow && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div className="admin-checkbox-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={newRequest.approveNow}
                      onChange={(e) => setNewRequest((f) => ({ ...f, approveNow: e.target.checked }))}
                    />
                    Review and approve now
                  </label>
                </div>
                <p style={{ margin: "0.35rem 0 0", color: "#666", fontSize: "0.85rem" }}>
                  This partner is restricted, so nothing above sends anywhere until an admin or editor reviews
                  it -- normally from the Pending Notifications page afterward. Checking this confirms, right
                  now, that the text you just typed is safe to send verbatim, skipping that extra trip. You'll
                  be asked to confirm the exact wording before saving.
                </p>
              </div>
            )}
            <SourcePicker
              files={files}
              sourceFileId={newRequest.sourceFileId}
              onChange={(source) => setNewRequest((f) => ({ ...f, ...source }))}
            />
            <label style={{ gridColumn: "1 / -1" }}>
              Admin Notes (optional, never shown publicly)
              <input
                value={newRequest.notes}
                onChange={(e) => setNewRequest((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
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
                  <div className="form-grid" style={{ flex: 1 }}>
                    <label>
                      Category
                      <select
                        value={editForm.category}
                        onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                      >
                        <option value="strategic">
                          Strategic (ministry vision/calling — can be shared publicly)
                        </option>
                        <option value="situational">
                          Situational (health, travel, family, logistics — admin-only)
                        </option>
                      </select>
                    </label>
                    <label>
                      Date Received
                      <input
                        type="date"
                        value={editForm.dateReceived}
                        onChange={(e) => setEditForm((f) => ({ ...f, dateReceived: e.target.value }))}
                        required
                      />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      Prayer Request
                      <textarea
                        rows={2}
                        value={editForm.requestText}
                        onChange={(e) => setEditForm((f) => ({ ...f, requestText: e.target.value }))}
                        required
                      />
                    </label>
                    {editForm.category === "strategic" && (
                      <div className="admin-checkbox-row" style={{ gridColumn: "1 / -1" }}>
                        <label title="Shows on this partner's public profile page, if the public site is enabled.">
                          <input
                            type="checkbox"
                            checked={editForm.isPublic}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                isPublic: e.target.checked,
                                includeInBooklet: e.target.checked && f.includeInBooklet,
                              }))
                            }
                          />
                          Show on public profile
                        </label>
                        {editForm.isPublic && (
                          <label title="Eligible to print in the booklet -- the actual number shown per partner is capped there (see the Booklet page) so this section doesn't take over the page.">
                            <input
                              type="checkbox"
                              checked={editForm.includeInBooklet}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, includeInBooklet: e.target.checked }))
                              }
                            />
                            Include in printed booklet
                          </label>
                        )}
                      </div>
                    )}
                    <SourcePicker
                      files={files}
                      sourceFileId={editForm.sourceFileId}
                      onChange={(source) => setEditForm((f) => ({ ...f, ...source }))}
                    />
                    <label style={{ gridColumn: "1 / -1" }}>
                      Admin Notes (optional, never shown publicly)
                      <input
                        value={editForm.notes}
                        onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                    </label>
                    <div style={{ gridColumn: "1 / -1", display: "flex", gap: "0.5rem" }}>
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
