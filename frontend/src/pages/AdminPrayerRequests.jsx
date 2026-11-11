import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPrayerRequests,
  createPrayerRequest,
  updatePrayerRequest,
  deletePrayerRequest,
  fetchPartners,
  fetchUrgentRecipientCount,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import SourceLink from "../components/admin/SourceLink.jsx";
import SourcePicker from "../components/admin/SourcePicker.jsx";
import { formatDate, todayInputValue } from "../utils/format.js";
import { DATE_RANGE_OPTIONS, inDateRange } from "../utils/dateRange.js";
import { urgentSendDescription } from "../utils/urgentSend.js";
import { entityFor } from "../utils/partnerEntity.js";
import useLoadMore from "../hooks/useLoadMore.js";
import useSourceFiles from "../hooks/useSourceFiles.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";
import { useSettings } from "../context/SettingsContext.jsx";
import LoadMoreButton from "../components/LoadMoreButton.jsx";
import UrgentSendConfirmBody from "../components/admin/UrgentSendConfirmBody.jsx";
import ApproveRestrictedTextConfirmBody from "../components/admin/ApproveRestrictedTextConfirmBody.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

const emptyNewRequest = {
  partnerId: "",
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

// Same shape as AdminOneTimeNeeds.jsx, but deliberately without that
// page's "Pending Decision" warning-toned status pill -- an open prayer
// request isn't a problem to flag, see the PrayerRequest model comment
// in schema.prisma. The only status called out here at all is
// "Answered", as a quiet note, not a checklist item.
export default function AdminPrayerRequests() {
  const { enabledFeatures } = useSettings();
  // Whether any channel exists at all to ever deliver a recorded event --
  // see PrayerRequestSection.jsx's own hasEnabledChannel for the full
  // reasoning (shared precondition for "Mark as urgent" and
  // canApproveNow below).
  const hasEnabledChannel =
    enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail;
  const [requests, setRequests] = useState([]);
  const [partners, setPartners] = useState([]);
  // isRestricted isn't a prop here (there's no single partner this page
  // is scoped to) -- looked up from whichever partner is currently
  // selected in the add form instead, same list this page's own
  // PartnerSelect already renders from.
  const [categoryFilter, setCategoryFilter] = useState("all"); // all | strategic | situational
  const [dateRangeFilter, setDateRangeFilter] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRequest, setNewRequest] = useState(emptyNewRequest);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answeringId, setAnsweringId] = useState(null);
  const [answer, setAnswer] = useState({ dateAnswered: todayInputValue(), answeredNote: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  // Scoped to whichever partner is selected in the add form, or whichever
  // request is being edited -- see the same hook used in AdminOneTimeNeeds.jsx.
  const { sourceFiles, loadSourceFiles } = useSourceFiles();
  const selectedPartner = partners.find((p) => p.id === newRequest.partnerId);
  // Also requires allowRestrictedPartnerNotifications, defaulting to true
  // while loading -- a UI convenience gate only, the real check is still
  // enforced server-side regardless.
  const { settings } = useChurchSettings();
  const allowRestrictedPartnerNotifications = settings?.allowRestrictedPartnerNotifications !== false;
  const canApproveNow =
    !!selectedPartner?.isRestricted && hasEnabledChannel && allowRestrictedPartnerNotifications;
  // Named confirmDialog, not confirm -- this page's only confirmation
  // surface now (approve-now, urgent-send, and delete all route through
  // it), and `confirm` would read as a reference to the native global
  // this hook replaces.
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  function reload() {
    fetchPrayerRequests().then(setRequests).catch(console.error);
  }

  useEffect(() => {
    reload();
    fetchPartners().then(setPartners).catch(console.error);
  }, []);

  const filteredRequests = requests.filter(
    (r) =>
      (categoryFilter === "all" || r.category === categoryFilter) &&
      inDateRange(r.dateReceived, dateRangeFilter)
  );
  const answeredCount = requests.filter((r) => r.status === "answered").length;
  const {
    visible: visibleRequests,
    hasMore,
    remaining,
    showMore,
  } = useLoadMore(filteredRequests, {
    initialCount: 25,
    step: 25,
  });

  async function handleAddSubmit(e) {
    e.preventDefault();
    setError("");
    if (!newRequest.partnerId) {
      setError("Choose a partner");
      return;
    }
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
      const { adminCount, publicCount } = await fetchUrgentRecipientCount(newRequest.partnerId);
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
        partnerId: newRequest.partnerId,
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
      loadSourceFiles(null);
      setShowAddForm(false);
      reload();
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
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to record the answer");
    }
  }

  // Deliberately doesn't touch status/dateAnswered/answeredNote -- that
  // workflow already has its own guarded flow (Record Answer, only shown
  // while a request is still open), and letting a generic content-edit
  // form also toggle status risks silently reopening an answered request.
  // This is for fixing the text/category/publicity/notes after the fact,
  // not for redoing the answer workflow.
  function startEdit(request) {
    setEditingId(request.id);
    setEditForm({
      category: request.category,
      requestText: request.requestText,
      dateReceived: String(request.dateReceived).slice(0, 10),
      isPublic: request.isPublic,
      includeInBooklet: request.includeInBooklet,
      notes: request.notes || "",
      sourceFileId: request.sourceFile?.id || null,
    });
    loadSourceFiles(request.partner?.id);
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
      reload();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save changes");
    }
  }

  async function handleDelete(request) {
    const entity = entityFor(request);
    const confirmed = await confirmDialog({
      title: `Delete this prayer request for ${entity.name}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await deletePrayerRequest(request.id);
    reload();
  }

  return (
    <div className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Prayer Requests</h2>
        <button className="btn" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Prayer Request"}
        </button>
      </div>
      <p style={{ color: "#666", marginTop: "0.25rem" }}>
        {requests.length} on file · {answeredCount} answered so far
      </p>

      {showAddForm && (
        <form onSubmit={handleAddSubmit} className="admin-section" style={{ marginTop: "1rem" }}>
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              Partner
              <PartnerSelect
                partners={partners}
                value={newRequest.partnerId}
                onChange={(partnerId) => {
                  setNewRequest((f) => ({ ...f, partnerId, sourceFileId: null }));
                  loadSourceFiles(partnerId);
                }}
                required
              />
            </label>
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
              files={sourceFiles}
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

      <div className="admin-checkbox-row" style={{ marginTop: "1rem" }}>
        <label
          htmlFor="prayer-category-filter"
          style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}
        >
          Show:
        </label>
        <select
          id="prayer-category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ width: "auto" }}
        >
          <option value="all">All</option>
          <option value="strategic">Strategic</option>
          <option value="situational">Situational</option>
        </select>
        <label
          htmlFor="prayer-date-range-filter"
          style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: "normal" }}
        >
          Received:
        </label>
        <select
          id="prayer-date-range-filter"
          value={dateRangeFilter}
          onChange={(e) => setDateRangeFilter(e.target.value)}
          style={{ width: "auto" }}
        >
          {DATE_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {visibleRequests.map((request) => {
        const entity = entityFor(request);
        return (
          <div key={request.id} className="repeatable-row" style={{ marginTop: "1rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <div>
                {entity.link ? (
                  <Link to={entity.link}>
                    {entity.name} ({entity.type})
                  </Link>
                ) : (
                  <span>{entity.name}</span>
                )}
              </div>
              <div className="table-actions">
                <button type="button" className="btn secondary small" onClick={() => startEdit(request)}>
                  Edit
                </button>
                {request.status !== "answered" && (
                  <button type="button" className="btn secondary small" onClick={() => startAnswer(request)}>
                    Record Answer
                  </button>
                )}
                <button type="button" className="btn danger small" onClick={() => handleDelete(request)}>
                  Delete
                </button>
              </div>
            </div>

            {editingId === request.id ? (
              <div className="form-grid" style={{ marginTop: "0.5rem" }}>
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
                          onChange={(e) => setEditForm((f) => ({ ...f, includeInBooklet: e.target.checked }))}
                        />
                        Include in printed booklet
                      </label>
                    )}
                  </div>
                )}
                <SourcePicker
                  files={sourceFiles}
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
                  <button type="button" className="btn small" onClick={() => submitEdit(request.id)}>
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
              <p style={{ margin: "0.5rem 0" }}>{request.requestText}</p>
            )}

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.9rem" }}>
              <div>
                <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Received</div>
                <div>
                  {formatDate(request.dateReceived)} ·{" "}
                  {request.category === "strategic" ? "Strategic" : "Situational"}
                  {request.category === "strategic" && request.isPublic && " · Public"}
                  {request.category === "strategic" &&
                    request.isPublic &&
                    request.includeInBooklet &&
                    " · In booklet"}
                </div>
              </div>
              {/* Same principle as PrayerRequestSection.jsx: only "answered"
                  gets a callout here. "ongoing"/"untracked" show nothing. */}
              {request.status === "answered" && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
                    Answered
                  </div>
                  <div style={{ color: "#2a5d3c" }}>
                    {formatDate(request.dateAnswered)}
                    {request.answeredNote && ` — ${request.answeredNote}`}
                  </div>
                </div>
              )}
              {request.notes && (
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>Notes</div>
                  <div>{request.notes}</div>
                </div>
              )}
            </div>
            <SourceLink sourceFile={request.sourceFile} />

            {answeringId === request.id && (
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
                <button type="button" className="btn small" onClick={() => submitAnswer(request.id)}>
                  Save
                </button>
                <button type="button" className="btn secondary small" onClick={() => setAnsweringId(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
      {filteredRequests.length === 0 && (
        <p style={{ color: "#888", marginTop: "1rem" }}>No prayer requests on file.</p>
      )}
      <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={showMore} />
      {confirmElement}
    </div>
  );
}
