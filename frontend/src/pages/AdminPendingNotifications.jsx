import React, { useEffect, useState } from "react";
import {
  fetchPendingNotifications,
  sendPendingNotifications,
  deletePendingNotification,
  updatePendingNotification,
} from "../api/client.js";
import NotificationReviewModal from "../components/admin/NotificationReviewModal.jsx";

// Groups blurbs by partner, nesting a request/need under the newsletter
// blurb it was sourced from -- same structure utils/emailDigest.js
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

function SentStatus({ blurb }) {
  const parts = [];
  if (blurb.groupmeSentAt) parts.push("GroupMe ✓");
  if (blurb.emailSentAt) parts.push("Email ✓");
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
const RESTRICTED_BG = "#fffbeb";

function RestrictedBadge() {
  return (
    <span
      style={{
        marginLeft: "0.5rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        background: RESTRICTED_BORDER,
        color: "#fff",
        fontSize: "0.75rem",
        fontWeight: 600,
        verticalAlign: "middle",
      }}
    >
      🔒 Restricted
    </span>
  );
}

// Same amber language as RestrictedBadge, worded differently -- this one
// means "nothing has gone out yet, and nothing will until this is
// reviewed," not just "this row's content is masked" (#187).
function AwaitingReviewBadge() {
  return (
    <span
      style={{
        marginLeft: "0.5rem",
        padding: "0.1rem 0.5rem",
        borderRadius: "999px",
        background: RESTRICTED_BORDER,
        color: "#fff",
        fontSize: "0.75rem",
        fontWeight: 600,
        verticalAlign: "middle",
      }}
    >
      Awaiting review
    </span>
  );
}

function BlurbRow({ blurb, onClear, clearing, onEdit, onQuickApprove, approving }) {
  return (
    <div
      style={{
        margin: "0.5rem 0 0.5rem 1rem",
        paddingLeft: "0.75rem",
        borderLeft: `3px solid ${blurb.isRestricted ? RESTRICTED_BORDER : "#e5e5e5"}`,
        background: blurb.isRestricted ? RESTRICTED_BG : "transparent",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "0.75rem",
      }}
    >
      <div>
        <strong>
          {blurb.emoji} {blurb.summary}
        </strong>
        <SentStatus blurb={blurb} />
        {blurb.needsReview && <AwaitingReviewBadge />}
        {blurb.isRestricted && blurb.reviewedAt && !blurb.needsReview && (
          <span style={{ color: "#2a5d3c", fontSize: "0.8rem", marginLeft: "0.5rem" }}>Reviewed ✓</span>
        )}
        <p style={{ margin: "0.25rem 0 0", color: "#555" }}>{blurb.bodyText}</p>
        {blurb.amount && <p style={{ margin: "0.25rem 0 0", fontWeight: 600 }}>Approved: {blurb.amount}</p>}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
        {blurb.needsReview && onQuickApprove && (
          <button
            type="button"
            className="btn secondary small"
            onClick={() => onQuickApprove(blurb)}
            disabled={approving}
          >
            {approving ? "Approving..." : "Approve"}
          </button>
        )}
        {onEdit && (
          <button type="button" className="btn secondary small" onClick={() => onEdit(blurb)}>
            Edit
          </button>
        )}
        {onClear && (
          <button
            type="button"
            className="btn secondary small"
            onClick={() => onClear(blurb.id)}
            disabled={clearing}
          >
            {clearing ? "Clearing..." : "Clear"}
          </button>
        )}
      </div>
    </div>
  );
}

// The actual notification queue -- what's waiting to go out, and the
// review/approve/edit/clear actions on it. Schedule, queue toggles, and
// digest appearance live on their own settings page (Site
// Administration -> Notifications, see AdminNotificationSettings.jsx)
// -- same "content, not settings" split Unmatched Emails already has
// from Email's own settings page.
export default function AdminPendingNotifications() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearingId, setClearingId] = useState(null);
  const [editingBlurb, setEditingBlurb] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function reloadPending() {
    return fetchPendingNotifications().then(setPending);
  }

  useEffect(() => {
    reloadPending()
      .catch((err) => setError(err.response?.data?.error || "Couldn't load pending notifications."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSendNow() {
    setSending(true);
    setError("");
    setSuccess("");
    try {
      const result = await sendPendingNotifications();
      await reloadPending();
      const heldNote =
        result.heldForReview > 0
          ? ` ${result.heldForReview} item${result.heldForReview === 1 ? "" : "s"} still awaiting review, excluded from this send.`
          : "";
      setSuccess(
        result.sent > 0
          ? `Sent ${result.sent} notification${result.sent === 1 ? "" : "s"}.${
              result.remaining > 0
                ? ` ${result.remaining} still queued (a channel's send didn't succeed).`
                : ""
            }${heldNote}`
          : `Nothing went out -- check that a channel is actually configured, or there's nothing queued.${heldNote}`
      );
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't send pending notifications.");
    } finally {
      setSending(false);
    }
  }

  // Discards one queued item for good -- works on any row, not just a
  // restricted one. No confirm dialog: same as every other delete in
  // this admin, a mis-click just means it's gone (it was never sent
  // anywhere, so there's nothing downstream to also undo).
  async function handleClear(id) {
    setClearingId(id);
    setError("");
    setSuccess("");
    try {
      await deletePendingNotification(id);
      await reloadPending();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't clear that notification.");
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
    setApprovingId(blurb.id);
    setError("");
    setSuccess("");
    try {
      const confirmed = window.confirm(
        `This partner is restricted. Approving marks this reviewed and eligible to send to any enabled ` +
          `notification channel -- their name, photo, and any source-file link stay masked regardless, but ` +
          `the exact wording below is what goes out as-is. Check it for anything else that could identify ` +
          `them or their location (a specific place, date, or detail only they'd be tied to) before approving.\n\n` +
          `Text to send:\n"${blurb.bodyText}"\n\n` +
          `Approve and send this as-is?`
      );
      if (!confirmed) return;
      const updated = await updatePendingNotification(blurb.id, blurb.bodyText);
      setPending((list) => list.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't approve that notification.");
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  const groups = groupByPartner(pending);
  const heldCount = pending.filter((p) => p.needsReview).length;
  const sendableCount = pending.length - heldCount;

  return (
    <div className="admin-shell">
      <h2>Pending Notifications</h2>
      <p style={{ color: "#555" }}>
        New prayer requests, one-time needs, and newsletters queue here instead of posting immediately --
        review and send them as a batch, on a schedule or on demand. For the schedule, queue toggles, and
        email digest appearance, see Site Administration → Notifications.
      </p>

      <div className="admin-section" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Pending ({pending.length})</h3>
          <button
            type="button"
            className="btn"
            onClick={handleSendNow}
            disabled={sending || sendableCount === 0}
          >
            {sending ? "Sending..." : "Send Pending Notifications Now"}
          </button>
        </div>
        {heldCount > 0 && (
          <p style={{ color: "#b45309", fontSize: "0.9rem" }}>
            {heldCount} awaiting review -- excluded from both manual and scheduled sends until reviewed.
          </p>
        )}
        {error && (
          <p style={{ color: "#b91c1c" }} role="alert">
            {error}
          </p>
        )}
        {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

        {groups.length === 0 && <p style={{ color: "#888" }}>Nothing waiting to go out.</p>}

        {groups.map((group) => (
          <div
            key={group.partnerName}
            style={{ marginTop: "1rem", paddingBottom: "1rem", borderBottom: "1px solid #e5e5e5" }}
          >
            <strong>{group.partnerName}</strong>
            {group.isRestricted && <RestrictedBadge />}
            {group.newsletters.map(({ blurb, children }) => (
              <div key={blurb.id}>
                <BlurbRow
                  blurb={blurb}
                  onClear={handleClear}
                  clearing={clearingId === blurb.id}
                  onEdit={setEditingBlurb}
                  onQuickApprove={handleQuickApprove}
                  approving={approvingId === blurb.id}
                />
                {children.map((child) => (
                  <div key={child.id} style={{ marginLeft: "1.5rem" }}>
                    <BlurbRow
                      blurb={child}
                      onClear={handleClear}
                      clearing={clearingId === child.id}
                      onEdit={setEditingBlurb}
                      onQuickApprove={handleQuickApprove}
                      approving={approvingId === child.id}
                    />
                  </div>
                ))}
              </div>
            ))}
            {group.standalone.map((blurb) => (
              <BlurbRow
                key={blurb.id}
                blurb={blurb}
                onClear={handleClear}
                clearing={clearingId === blurb.id}
                onEdit={setEditingBlurb}
                onQuickApprove={handleQuickApprove}
                approving={approvingId === blurb.id}
              />
            ))}
          </div>
        ))}
      </div>

      {editingBlurb && (
        <NotificationReviewModal
          blurb={editingBlurb}
          onSaved={handleEditSaved}
          onClose={() => setEditingBlurb(null)}
        />
      )}
    </div>
  );
}
