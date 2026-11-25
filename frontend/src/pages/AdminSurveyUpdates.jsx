import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSurveyUpdates, approveSurveyUpdate, rejectSurveyUpdate } from "../api/client.js";
import PageHeader from "../components/shared/PageHeader.jsx";
import TabBar from "../components/shared/TabBar.jsx";
import Table from "../components/shared/Table.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import { formatDate } from "../utils/format.js";

// What partners' survey answers suggest changing on their record. Nothing here has been applied:
// a person approves it (optionally editing the value first), or rejects it and the record stays
// as it is. A photo is held until approved, then becomes the partner's current photo.
export default function AdminSurveyUpdates() {
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState("");
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  const reload = useCallback(
    () =>
      fetchSurveyUpdates(tab)
        .then((r) => {
          setRows(r);
          setError("");
        })
        .catch(() => setError("Couldn't load the updates.")),
    [tab]
  );
  useEffect(() => {
    setRows(null);
    reload();
  }, [reload]);

  async function act(fn) {
    setError("");
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    }
  }

  async function reject(u) {
    const ok = await confirmDialog({
      title: "Reject this change?",
      body: (
        <p>
          {u.partnerName}&apos;s record stays as it is{u.photoUploadId ? ", and the photo is deleted" : ""}.
        </p>
      ),
      confirmLabel: "Reject",
      danger: true,
    });
    if (ok) act(() => rejectSurveyUpdate(u.id));
  }

  const pendingTab = tab === "pending";
  return (
    <div className="admin-shell">
      <PageHeader
        title="Survey Updates"
        subtitle={pendingTab && rows ? `${rows.length} waiting for a decision` : null}
        description="Changes partners' survey answers suggest to their record. Nothing is applied until you approve it."
      />
      <TabBar
        ariaLabel="Survey update views"
        activeKey={tab}
        tabs={[
          { key: "pending", label: "To review", onClick: () => setTab("pending") },
          { key: "decided", label: "Decided", onClick: () => setTab("decided") },
        ]}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {rows && (
        <Table
          rows={rows}
          emptyMessage={pendingTab ? "Nothing to review right now." : "Nothing decided yet."}
          columns={[
            {
              key: "partnerName",
              label: "Partner",
              render: (u) => <Link to={`/admin/partners/${u.partnerId}`}>{u.partnerName}</Link>,
              stopRowClick: true,
            },
            { key: "fieldLabel", label: "Change" },
            {
              key: "current",
              label: "Now",
              render: (u) => (u.photoUploadId || u.field === "photo" ? "" : u.currentValue || "—"),
            },
            {
              key: "proposed",
              label: pendingTab ? "Suggested" : "Result",
              render: (u) =>
                u.photoUploadId ? (
                  <img
                    src={`/api/survey-updates/photo/${u.photoUploadId}`}
                    alt={`Sent by ${u.partnerName}`}
                    style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6 }}
                  />
                ) : pendingTab ? (
                  u.proposedValue
                ) : (
                  `${u.status === "approved" ? "Applied" : "Rejected"}${u.appliedValue ? `: ${u.appliedValue}` : ""}`
                ),
            },
            { key: "surveyTitle", label: "From" },
            pendingTab
              ? { key: "createdAt", label: "Sent", type: "date" }
              : {
                  key: "decidedBy",
                  label: "Decided",
                  render: (u) => `${u.decidedByName || ""} ${formatDate(u.decidedAt)}`,
                },
          ]}
          renderActions={
            pendingTab
              ? (u) => (
                  <>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => act(() => approveSurveyUpdate(u.id))}
                    >
                      Approve
                    </button>
                    {!u.photoUploadId && u.field !== "photo" && (
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => {
                          setValue(u.proposedValue || "");
                          setEditing(u);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    <button type="button" className="btn danger small" onClick={() => reject(u)}>
                      Reject
                    </button>
                  </>
                )
              : undefined
          }
        />
      )}
      {editing && (
        <QuickActionModal
          title={`${editing.fieldLabel}: ${editing.partnerName}`}
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            await approveSurveyUpdate(editing.id, value);
            await reload();
          }}
          submitLabel="Approve with this value"
          submitDisabled={!value.trim()}
        >
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            On file now: {editing.currentValue || "nothing"}. They answered: {editing.proposedValue}.
          </p>
          <label>
            Value to put on their record
            <input value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        </QuickActionModal>
      )}
      {confirmElement}
    </div>
  );
}
