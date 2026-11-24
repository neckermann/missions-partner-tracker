import React, { useEffect, useState } from "react";
import { fetchPendingDispatches, deletePendingDispatch, updatePendingDispatch } from "../api/client.js";
import DispatchReviewModal from "../components/admin/DispatchReviewModal.jsx";
import ApproveRestrictedTextConfirmBody from "../components/admin/ApproveRestrictedTextConfirmBody.jsx";
import ApproveCareTeamTextConfirmBody from "../components/admin/ApproveCareTeamTextConfirmBody.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import Table from "../components/shared/Table.jsx";
import { truncate } from "../utils/truncate.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

// Groups blurbs by partner, nesting a request/need under the newsletter
// blurb it was sourced from -- same structure adminEmailDispatchContent.js
// renders, so this preview matches what actually goes out. Duplicated
// here rather than shared with the backend since it's purely a display
// concern, not a contract either side depends on the other to honor.
function groupByPartner(blurbs) {
  const byPartner = new Map();
  for (const blurb of blurbs) {
    if (!byPartner.has(blurb.partnerId)) {
      byPartner.set(blurb.partnerId, {
        partnerName: blurb.partnerName,
        // Uniform across every blurb from the same partner -- grabbed
        // off whichever blurb happens to create the group.
        isRestricted: blurb.isRestricted,
        newsletters: [],
        standalone: [],
      });
    }
    if (blurb.type === "newsletterCreated") {
      byPartner.get(blurb.partnerId).newsletters.push({ blurb, children: [] });
    }
  }
  for (const blurb of blurbs) {
    if (blurb.type === "newsletterCreated") continue;
    const group = byPartner.get(blurb.partnerId);
    const parent = blurb.sourceFileId
      ? group.newsletters.find((n) => n.blurb.newsletterId === blurb.sourceFileId)
      : null;
    if (parent) parent.children.push(blurb);
    else group.standalone.push(blurb);
  }
  return [...byPartner.values()];
}

// Flattens the partner/newsletter/child nesting above into one row per
// blurb for the shared Table -- a `sourceLabel` on a child row replaces
// the visual indentation the old hand-rolled layout used, and rows stay
// grouped together (partner, then its newsletters+children, then its
// standalone items) by construction order, same reading order as before.
function flattenRows(groups) {
  const rows = [];
  for (const group of groups) {
    for (const { blurb, children } of group.newsletters) {
      rows.push({
        blurb,
        partnerName: group.partnerName,
        isRestrictedGroup: group.isRestricted,
        sourceLabel: null,
      });
      for (const child of children) {
        rows.push({
          blurb: child,
          partnerName: group.partnerName,
          isRestrictedGroup: group.isRestricted,
          sourceLabel: blurb.summary,
        });
      }
    }
    for (const blurb of group.standalone) {
      rows.push({
        blurb,
        partnerName: group.partnerName,
        isRestrictedGroup: group.isRestricted,
        sourceLabel: null,
      });
    }
  }
  return rows;
}

function SentStatus({ blurb }) {
  const parts = [];
  if (blurb.groupmeDispatchedAt) parts.push("GroupMe ✓");
  if (blurb.whatsappDispatchedAt) parts.push("WhatsApp ✓");
  if (
    blurb.biweeklyEmailDispatchSentAt ||
    blurb.monthlyEmailDispatchSentAt ||
    blurb.quarterlyEmailDispatchSentAt
  ) {
    parts.push("Email ✓");
  }
  if (parts.length === 0) return null;
  return (
    <span style={{ color: "#888", fontSize: "0.8rem", marginLeft: "0.5rem" }}>({parts.join(", ")})</span>
  );
}

// Amber, not this app's own red/danger color -- "restricted" isn't an
// error state, it's a heads-up that this row's content is already masked
// and should stay that way (no copy-pasting the real details into
// GroupMe/email by hand, no assuming the summary is the full story).
const RESTRICTED_BORDER = "#b45309";

function RestrictedBadge() {
  return (
    <span style={{ marginLeft: "0.5rem" }}>
      <StatusPill label="🔒 Restricted" color={RESTRICTED_BORDER} />
    </span>
  );
}

// Same amber language as RestrictedBadge, worded differently -- this one
// means "nothing has gone out yet, and nothing will until this is
// reviewed," not just "this row's content is masked" (#187).
//
// `byCareTeam` (#289): the item is held not because the partner is restricted
// but because a care team member entered it, so say that.
function AwaitingReviewBadge({ byCareTeam = false }) {
  return (
    <span style={{ marginLeft: "0.5rem" }}>
      <StatusPill
        label={byCareTeam ? "Awaiting review · entered by a care team member" : "Awaiting review"}
        color={RESTRICTED_BORDER}
      />
    </span>
  );
}

// The actual dispatch queue -- what's waiting to go out, and the
// review/approve/edit/clear actions on it. Schedule, queue toggles, and
// email dispatch appearance live on their own settings page (Site
// Administration -> Dispatch Settings, see AdminDispatchSettings.jsx)
// -- same "content, not settings" split Unmatched Emails already has
// from Email's own settings page.
//
// Click-row-opens-popup, same convention as every other consolidated
// list: a row opens DispatchReviewModal (edit + approve-while-saving,
// already self-contained) when canWrite. A viewer never gets this --
// DispatchReviewModal's own text-reveal fetch is itself admin/editor-only
// server-side, and the content a viewer is entitled to see is already
// fully visible in the row, so there's no separate read-only popup to
// build here (same reasoning as an inactive EditableSection's view stays
// on the page instead of needing its own redundant popup).
export default function AdminPendingDispatches() {
  const { canWrite } = useCurrentUser();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clearingId, setClearingId] = useState(null);
  const [editingBlurb, setEditingBlurb] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  function reloadPending() {
    return fetchPendingDispatches().then(setPending);
  }

  useEffect(() => {
    reloadPending()
      .catch((err) => setError(err.response?.data?.error || "Couldn't load pending dispatches."))
      .finally(() => setLoading(false));
  }, []);

  // Discards one queued item for good -- works on any row, not just a
  // restricted one. No confirm dialog: same as every other delete in
  // this admin, a mis-click just means it's gone (it was never sent
  // anywhere, so there's nothing downstream to also undo).
  async function handleClear(id) {
    setClearingId(id);
    setError("");
    setSuccess("");
    try {
      await deletePendingDispatch(id);
      await reloadPending();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't clear that dispatch.");
    } finally {
      setClearingId(null);
    }
  }

  // Merges an edited row back into the list in place -- no need to
  // re-fetch the whole queue just to reflect one saved edit.
  function handleEditSaved(updated) {
    setPending((list) => list.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
  }

  // The lightweight path for a held row that doesn't need any wording
  // changed -- skips opening the full edit modal, but carries the exact
  // same real-world consequence as saving there (it clears the hold, so
  // this is sendable from here on), so it gets the same safety gate:
  // make the admin explicitly confirm the real text before it's saved
  // as-is. No separate reveal call needed -- blurb.bodyText is already
  // the real (unmasked) text here, not the placeholder: GET /pending
  // returns it unmasked for any held row, since the underlying
  // request/need text was never actually hidden from any role in the
  // first place (GET /api/prayer-requests and /api/support-needs show
  // it to anyone logged in, restricted or not -- see ADMIN_GUIDE.md §
  // Who can see what).
  async function handleQuickApprove(blurb) {
    const confirmed = await confirmDialog({
      title: "Approve and send?",
      body:
        blurb.reviewRequired && !blurb.isRestricted ? (
          <ApproveCareTeamTextConfirmBody text={blurb.bodyText} />
        ) : (
          <ApproveRestrictedTextConfirmBody text={blurb.bodyText} />
        ),
      confirmLabel: "Approve and send",
    });
    if (!confirmed) return;
    setApprovingId(blurb.id);
    setError("");
    setSuccess("");
    try {
      const updated = await updatePendingDispatch(blurb.id, blurb.bodyText);
      setPending((list) => list.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't approve that dispatch.");
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  const groups = groupByPartner(pending);
  const rows = flattenRows(groups);
  const heldCount = pending.filter((p) => p.needsReview).length;

  return (
    <div className="admin-shell">
      <h2>Pending Dispatches</h2>
      <p style={{ color: "#555" }}>
        New prayer requests, one-time needs, and newsletters queue here instead of posting immediately -- each
        one clears once every channel it's relevant to (GroupMe, WhatsApp, the admin email, the public email)
        has handled it, on its own schedule. For schedules, the chat channels' content-type mutes, and email
        dispatch appearance, see Settings → Dispatch Settings.
      </p>

      {heldCount > 0 && (
        <p style={{ color: "#b45309", fontSize: "0.9rem" }}>
          {heldCount} awaiting review -- excluded from every channel's send, including an urgent one, until
          reviewed.
        </p>
      )}
      {error && (
        <p style={{ color: "#b91c1c" }} role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <Table
        style={{ marginTop: "1rem" }}
        rows={rows}
        rowKey={(row) => row.blurb.id}
        emptyMessage="Nothing waiting to go out."
        onRowClick={canWrite ? (row) => setEditingBlurb(row.blurb) : undefined}
        columns={[
          {
            key: "partnerName",
            label: "Partner",
            render: (row) => (
              <>
                <span style={{ fontWeight: 600 }}>{row.partnerName}</span>
                {row.isRestrictedGroup && <RestrictedBadge />}
              </>
            ),
          },
          {
            key: "content",
            label: "Content",
            render: (row) => (
              <>
                <div>
                  {row.blurb.emoji} <strong>{row.blurb.summary}</strong>
                  <SentStatus blurb={row.blurb} />
                  {row.blurb.needsReview && (
                    <AwaitingReviewBadge byCareTeam={row.blurb.reviewRequired && !row.blurb.isRestricted} />
                  )}
                  {row.blurb.isRestricted && row.blurb.dispatchReviewedAt && !row.blurb.needsReview && (
                    <span style={{ color: "#2a5d3c", fontSize: "0.8rem", marginLeft: "0.5rem" }}>
                      Reviewed ✓
                    </span>
                  )}
                </div>
                <div style={{ color: "#555", marginTop: "0.25rem" }}>{truncate(row.blurb.bodyText, 100)}</div>
                {row.blurb.amount && (
                  <div style={{ marginTop: "0.25rem", fontWeight: 600 }}>
                    {row.blurb.amountLabel || "Approved"}: {row.blurb.amount}
                  </div>
                )}
              </>
            ),
          },
          {
            key: "sourceLabel",
            label: "Source",
            render: (row) => (row.sourceLabel ? `↳ from: ${truncate(row.sourceLabel, 40)}` : "—"),
          },
        ]}
        renderActions={(row) => (
          <>
            {canWrite && row.blurb.needsReview && (
              <button
                type="button"
                className="btn secondary small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuickApprove(row.blurb);
                }}
                disabled={approvingId === row.blurb.id}
              >
                {approvingId === row.blurb.id ? "Approving..." : "Approve"}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                className="btn secondary small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear(row.blurb.id);
                }}
                disabled={clearingId === row.blurb.id}
              >
                {clearingId === row.blurb.id ? "Clearing..." : "Clear"}
              </button>
            )}
          </>
        )}
      />

      {editingBlurb && (
        <DispatchReviewModal
          blurb={editingBlurb}
          onSaved={handleEditSaved}
          onClose={() => setEditingBlurb(null)}
        />
      )}
      {confirmElement}
    </div>
  );
}
