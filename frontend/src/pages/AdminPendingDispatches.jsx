import React, { useEffect, useState } from "react";
import PageHeader from "../components/shared/PageHeader.jsx";
import { fetchPendingDispatches, deletePendingDispatch, updatePendingDispatch } from "../api/client.js";
import DispatchReviewModal from "../components/admin/DispatchReviewModal.jsx";
import ApproveRestrictedTextConfirmBody from "../components/admin/ApproveRestrictedTextConfirmBody.jsx";
import ApproveCareTeamTextConfirmBody from "../components/admin/ApproveCareTeamTextConfirmBody.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import Table from "../components/shared/Table.jsx";
import { truncate } from "../utils/truncate.js";
import useCurrentUser from "../hooks/useCurrentUser.js";
import { useSettings } from "../context/SettingsContext.jsx";
import CopyButton from "../components/shared/CopyButton.jsx";

// Groups blurbs by partner, nesting a request/need under the newsletter blurb it came from,
// same structure as adminEmailDispatchContent.js so the preview matches what goes out.
// Duplicated rather than shared with the backend: display only, not a contract.
function groupByPartner(blurbs) {
  const byPartner = new Map();
  for (const blurb of blurbs) {
    if (!byPartner.has(blurb.partnerId)) {
      byPartner.set(blurb.partnerId, {
        partnerName: blurb.partnerName,
        // Uniform across the partner's blurbs; taken from whichever creates the group.
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

// Flattens the nesting above into one row per blurb for the shared Table; a `sourceLabel` on
// a child row stands in for indentation. Order: partner, its newsletters+children, standalone items.
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
    <span style={{ color: "var(--muted)", fontSize: "0.8rem", marginLeft: "0.5rem" }}>
      ({parts.join(", ")})
    </span>
  );
}

// Amber, not the danger red: "restricted" isn't an error, it's a heads-up that the row's
// content is masked and should stay that way (don't copy real details into GroupMe/email).
const RESTRICTED_BORDER = "#b45309";

function RestrictedBadge() {
  return (
    <span style={{ marginLeft: "0.5rem" }}>
      <StatusPill label="🔒 Restricted" color={RESTRICTED_BORDER} />
    </span>
  );
}

// Same amber language as RestrictedBadge: nothing has gone out and nothing will until reviewed.
// `byCareTeam`: held because a care team member entered it, not because the partner is restricted.
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

// The dispatch queue: what's waiting to go out, with review/approve/edit/clear actions.
// Schedule and appearance live on Dispatch Settings (AdminDispatchSettings.jsx).
// A row opens DispatchReviewModal when canWrite. A viewer gets no popup: the modal's
// text-reveal fetch is admin/editor-only server-side, and a viewer already sees all they may.
// The email-off option for dispatches: with Email (Sending), GroupMe and WhatsApp all off, nothing goes out on its
// own and queued items just wait, so this is the plain text of what is ready (not held for review) to copy and
// share yourself, grouped by partner.
function waitingText(blurbs) {
  const lines = ["Updates ready to share"];
  for (const group of groupByPartner(blurbs.filter((b) => !b.needsReview))) {
    lines.push("", group.partnerName);
    const all = [...group.newsletters.flatMap((n) => [n.blurb, ...n.children]), ...group.standalone];
    for (const b of all) lines.push(`- ${b.emoji} ${b.summary}: ${b.bodyText}`);
  }
  return lines.join("\n");
}

export default function AdminPendingDispatches() {
  const { canWrite } = useCurrentUser();
  const { enabledFeatures } = useSettings();
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
      .catch((err) => setError(err.response?.data?.error || "Couldn't load the updates to share."))
      .finally(() => setLoading(false));
  }, []);

  // Discards a queued item for good, on any row. It was never sent anywhere, and there is no getting it back, so
  // it asks first.
  async function handleClear(id) {
    const confirmed = await confirmDialog({
      title: "Clear this update?",
      body: (
        <ConfirmMessageBody>
          It will not be sent anywhere, and it can't be brought back. If you only want to change the wording,
          open it instead.
        </ConfirmMessageBody>
      ),
      confirmLabel: "Clear",
      danger: true,
    });
    if (!confirmed) return;
    setClearingId(id);
    setError("");
    setSuccess("");
    try {
      await deletePendingDispatch(id);
      await reloadPending();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't clear that update.");
    } finally {
      setClearingId(null);
    }
  }

  // Merge an edited row back in place instead of re-fetching the queue.
  function handleEditSaved(updated) {
    setPending((list) => list.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
  }

  // Approve a held row without editing. It has the same consequence as saving in the modal
  // (clears the hold), so the admin must confirm the real text first. blurb.bodyText is already
  // the unmasked text: GET /pending returns it for held rows because the underlying
  // request/need text is visible to any logged-in role (see ADMIN_GUIDE.md § Who can see what).
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
      setError(err.response?.data?.error || "Couldn't approve that update.");
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  const groups = groupByPartner(pending);
  const rows = flattenRows(groups);
  const heldCount = pending.filter((p) => p.needsReview).length;
  const noChannelOn =
    !enabledFeatures?.outboundEmail && !enabledFeatures?.groupme && !enabledFeatures?.whatsapp;
  const readyCount = pending.length - heldCount;

  return (
    <div className="admin-shell">
      <PageHeader
        title="Updates to Share"
        description="New prayer requests, one-time needs, and newsletters wait here instead of posting immediately. Each clears once every channel it applies to (GroupMe, WhatsApp, the admin email, the public email) has handled it, on its own schedule. Schedules, what gets posted to chat and how the email looks are under Settings → Sending Updates."
      />

      {noChannelOn && readyCount > 0 && (
        <div className="admin-section" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
          <p style={{ marginTop: 0, fontWeight: 600 }}>Nothing here goes out on its own</p>
          <p style={{ color: "var(--muted)" }}>
            Email (Sending), GroupMe and WhatsApp are all off, so these updates just wait. Copy the{" "}
            {readyCount} that {readyCount === 1 ? "is" : "are"} ready and share{" "}
            {readyCount === 1 ? "it" : "them"} however you like, then clear {readyCount === 1 ? "it" : "them"}{" "}
            from the list below.
          </p>
          <CopyButton text={waitingText(pending)} label="Copy the updates that are ready" showText />
        </div>
      )}

      {heldCount > 0 && (
        <p style={{ color: "var(--warn)", fontSize: "0.9rem" }}>
          {heldCount} awaiting review — excluded from every channel's send, including an urgent one, until
          reviewed.
        </p>
      )}
      {error && (
        <p style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "var(--accent)" }}>{success}</p>}

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
                    <span style={{ color: "var(--accent)", fontSize: "0.8rem", marginLeft: "0.5rem" }}>
                      Reviewed ✓
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--muted)", marginTop: "0.25rem" }}>
                  {truncate(row.blurb.bodyText, 100)}
                </div>
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
          // Stacked, not side by side: two buttons in a row pushed Clear past the edge of a phone.
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "0.4rem" }}>
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
          </div>
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
