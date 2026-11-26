import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSurveyUpdates, approveSurveyUpdate, rejectSurveyUpdate } from "../api/client.js";
import PageHeader from "../components/shared/PageHeader.jsx";
import TabBar from "../components/shared/TabBar.jsx";
import Table from "../components/shared/Table.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import { formatDate } from "../utils/format.js";
import { ADDRESS_PARTS, addressToValue, parseAddressValue, formatAddressValue } from "../utils/address.js";

const MAILING = "mailingAddress";
// A stored address is one JSON line; everything else is plain text.
const SUPPORT = "supportPreferences";
const showNow = (u) =>
  u.field === SUPPORT
    ? u.currentDisplay
    : u.field === MAILING
      ? formatAddressValue(u.currentValue)
      : u.currentValue;
const showSuggested = (u) =>
  u.field === SUPPORT
    ? u.proposedDisplay
    : u.field === MAILING
      ? formatAddressValue(u.proposedValue)
      : u.proposedValue;

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

  // Pending changes grouped by partner, so one partner's answers are decided together.
  const groups = [];
  for (const u of rows || []) {
    let g = groups.find((x) => x.partnerId === u.partnerId);
    if (!g) groups.push((g = { partnerId: u.partnerId, partnerName: u.partnerName, items: [] }));
    g.items.push(u);
  }

  // Applies a decision to every change in a group, stopping at the first that can't be applied so
  // the person sees why (the rest stay waiting).
  async function decideAll(group, decision) {
    if (decision === "reject") {
      const ok = await confirmDialog({
        title: `Reject all ${group.items.length} changes?`,
        body: <p>{group.partnerName}&apos;s record stays as it is, and any photo is deleted.</p>,
        confirmLabel: "Reject all",
        danger: true,
      });
      if (!ok) return;
    }
    setError("");
    try {
      for (const u of group.items) {
        if (decision === "approve") await approveSurveyUpdate(u.id);
        else await rejectSurveyUpdate(u.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. The rest are still waiting.");
    }
    await reload();
  }
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
      {rows && pendingTab && groups.length === 0 && (
        <p style={{ color: "var(--muted)" }}>Nothing to review right now.</p>
      )}
      {rows &&
        pendingTab &&
        groups.map((g) => (
          <div key={g.partnerId} className="admin-section" style={{ marginBottom: "1rem" }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}
            >
              <h3 style={{ margin: 0 }}>
                <Link to={`/admin/partners/${g.partnerId}`}>{g.partnerName}</Link>
                <span style={{ color: "var(--muted)", fontWeight: "normal", fontSize: "0.9rem" }}>
                  {" "}
                  · {g.items[0].surveyTitle}
                </span>
              </h3>
              {g.items.length > 1 && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="btn small" onClick={() => decideAll(g, "approve")}>
                    Approve all {g.items.length}
                  </button>
                  <button type="button" className="btn danger small" onClick={() => decideAll(g, "reject")}>
                    Reject all
                  </button>
                </div>
              )}
            </div>
            <ul className="survey-change-list">
              {g.items.map((u) => (
                <li key={u.id} className="survey-change">
                  <div className="survey-change-field">{u.fieldLabel}</div>
                  <div className="survey-change-values">
                    {u.photoUploadId ? (
                      <img
                        src={`/api/survey-updates/photo/${u.photoUploadId}`}
                        alt={`Sent by ${u.partnerName}`}
                        style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6 }}
                      />
                    ) : (
                      <>
                        <span>
                          <span className="survey-change-label">Now</span> {showNow(u) || "—"}
                        </span>
                        <span>
                          <span className="survey-change-label">Suggested</span>{" "}
                          <strong>{showSuggested(u)}</strong>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="survey-change-actions">
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => act(() => approveSurveyUpdate(u.id))}
                    >
                      Approve
                    </button>
                    {!u.photoUploadId && u.field !== "photo" && u.field !== SUPPORT && (
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
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      {rows && !pendingTab && (
        <Table
          rows={rows}
          emptyMessage="Nothing decided yet."
          columns={[
            {
              key: "partnerName",
              label: "Partner",
              render: (u) => <Link to={`/admin/partners/${u.partnerId}`}>{u.partnerName}</Link>,
              stopRowClick: true,
            },
            { key: "fieldLabel", label: "Change" },
            {
              key: "proposed",
              label: "Result",
              render: (u) =>
                `${u.status === "approved" ? "Applied" : "Rejected"}${u.appliedValue ? `: ${u.appliedValue}` : ""}`,
            },
            { key: "surveyTitle", label: "From" },
            {
              key: "decidedBy",
              label: "Decided",
              render: (u) => `${u.decidedByName || ""} ${formatDate(u.decidedAt)}`,
            },
          ]}
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
            On file now: {showNow(editing) || "nothing"}. They answered: {showSuggested(editing)}.
          </p>
          {editing.field === MAILING ? (
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend>Mailing address to put on their record</legend>
              {ADDRESS_PARTS.map((part) => (
                <label key={part.key} style={{ display: "block", fontWeight: "normal" }}>
                  {part.label}
                  <input
                    value={parseAddressValue(value)[part.key] || ""}
                    onChange={(e) =>
                      setValue(addressToValue({ ...parseAddressValue(value), [part.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              Value to put on their record
              <input value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
        </QuickActionModal>
      )}
      {confirmElement}
    </div>
  );
}
