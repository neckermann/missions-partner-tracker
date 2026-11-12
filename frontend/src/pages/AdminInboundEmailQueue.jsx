import React, { useEffect, useState } from "react";
import {
  fetchPendingInboundEmails,
  assignInboundEmail,
  discardInboundEmail,
  fetchPartners,
  fetchTrips,
  fetchCurrentUser,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import TripParticipantSelect from "../components/admin/TripParticipantSelect.jsx";
import { FILE_KINDS } from "../utils/fileKinds.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { useSettings } from "../context/SettingsContext.jsx";

// The review queue for inbound emails the webhook (see routes/inboundEmail.js)
// couldn't automatically match to exactly one partner -- zero matches, or
// more than one distinct partner sharing the sender address. A list page,
// not a modal: unlike ExtractionReviewModal.jsx (a transient scan result
// tied to one already-open file), this is a standing, independently-
// paginated queue an admin returns to over time.
//
// A row's mere existence means "pending" -- there's no status field (see
// the InboundEmail model comment in schema.prisma), so both assign and
// discard just remove the row.
export default function AdminInboundEmailQueue() {
  const { enabledFeatures } = useSettings();
  const [emails, setEmails] = useState([]);
  const [partners, setPartners] = useState([]);
  const [trips, setTrips] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Per-row UI state, keyed by email id -- whether this row is being
  // assigned to a Partner or a TripParticipant, the chosen partner/
  // participant/requirement in that row's pickers, the chosen file kind
  // (#206, defaults to "newsletter" same as the backend's own default --
  // only meaningful in Partner mode, a TripParticipant has no "kind"), a
  // free-typed label when kind is "other", and which row (if any) is
  // mid-request.
  const [assignModes, setAssignModes] = useState({});
  const [selections, setSelections] = useState({});
  const [participantSelections, setParticipantSelections] = useState({});
  const [requirementSelections, setRequirementSelections] = useState({});
  const [kindSelections, setKindSelections] = useState({});
  const [customKindSelections, setCustomKindSelections] = useState({});
  const [busyId, setBusyId] = useState(null);
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  function reload() {
    return fetchPendingInboundEmails()
      .then(setEmails)
      .catch((err) => setError(err.response?.data?.error || "Couldn't load the unmatched emails queue."));
  }

  useEffect(() => {
    Promise.all([
      reload(),
      fetchPartners().then(setPartners),
      fetchCurrentUser().then(setCurrentUser),
      // Only when trips is on -- GET /api/trips 404s entirely otherwise
      // (router.use(requireFeature("trips")) gates the whole router), and
      // there'd be nothing to assign to a participant anyway.
      enabledFeatures.trips ? fetchTrips().then(setTrips) : Promise.resolve(),
    ]).finally(() => setLoading(false));
  }, [enabledFeatures.trips]);

  function handleViewRaw(email) {
    // Same same-origin, cookie-authenticated pattern as AdminPartnerFiles.jsx's
    // handleView -- the browser sends the session cookie automatically.
    window.open(`/api/inbound-email/${email.id}/raw`, "_blank");
  }

  async function handleAssign(email) {
    const mode = assignModes[email.id] || "partner";

    if (mode === "participant") {
      const tripParticipantId = participantSelections[email.id];
      if (!tripParticipantId) {
        setError("Choose a trip participant before assigning.");
        return;
      }
      setError("");
      setBusyId(email.id);
      try {
        await assignInboundEmail(email.id, {
          tripParticipantId,
          requirementId: requirementSelections[email.id] || null,
        });
        await reload();
      } catch (err) {
        setError(err.response?.data?.error || "Couldn't assign this email.");
      } finally {
        setBusyId(null);
      }
      return;
    }

    const partnerId = selections[email.id];
    if (!partnerId) {
      setError("Choose a partner before assigning.");
      return;
    }
    const kind = kindSelections[email.id] || FILE_KINDS[0].value;
    const customKind = customKindSelections[email.id] || "";
    if (kind === "other" && !customKind.trim()) {
      setError('Enter a kind label before assigning as "Other".');
      return;
    }
    setError("");
    setBusyId(email.id);
    try {
      await assignInboundEmail(email.id, { partnerId, kind, customKind });
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't assign this email.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscard(email) {
    const confirmed = await confirmDialog({
      title: `Discard this email from ${email.fromAddress}?`,
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Discard",
      danger: true,
    });
    if (!confirmed) return;
    setError("");
    setBusyId(email.id);
    try {
      await discardInboundEmail(email.id);
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't discard this email.");
    } finally {
      setBusyId(null);
    }
  }

  const canAssign = currentUser?.role === "admin" || currentUser?.role === "editor";
  const canDiscard = currentUser?.role === "admin";

  if (loading) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>Unmatched Emails</h2>
      <p style={{ color: "#555" }}>
        Inbound emails that couldn't be automatically matched to exactly one partner -- either no partner's
        contact or household-adult email matched the sender, or more than one did. Assign each to the right
        partner, picking what kind of file it actually is -- or, if trips are on, to a trip participant
        instead, optionally marking which document requirement it fulfills -- or discard it.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <table className="admin-table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>From</th>
            <th>Subject</th>
            <th>Received</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => {
            const busy = busyId === email.id;
            return (
              <tr key={email.id}>
                <td>{email.fromAddress}</td>
                <td>{email.subject || "—"}</td>
                <td>{new Date(email.receivedAt).toLocaleString()}</td>
                <td className="table-actions-stack">
                  {canAssign && (
                    <div className="table-actions-row">
                      {trips.length > 0 && (
                        <select
                          aria-label="Assign to"
                          value={assignModes[email.id] || "partner"}
                          onChange={(e) => setAssignModes((m) => ({ ...m, [email.id]: e.target.value }))}
                          disabled={busy}
                          style={{ width: "auto", minWidth: "8rem" }}
                        >
                          <option value="partner">Partner</option>
                          <option value="participant">Trip participant</option>
                        </select>
                      )}
                      {(assignModes[email.id] || "partner") === "participant" ? (
                        <>
                          <TripParticipantSelect
                            trips={trips}
                            value={participantSelections[email.id] || ""}
                            onChange={(participantId) =>
                              setParticipantSelections((s) => ({ ...s, [email.id]: participantId }))
                            }
                            disabled={busy}
                            style={{ width: "auto", display: "inline-block" }}
                          />
                          {(() => {
                            const participantId = participantSelections[email.id];
                            const trip = trips.find((t) =>
                              (t.participants || []).some((p) => p.id === participantId)
                            );
                            const requirements = trip?.documentRequirements || [];
                            if (!participantId || requirements.length === 0) return null;
                            return (
                              <>
                                <span className="table-actions-as">fulfilling</span>
                                <select
                                  aria-label="Document requirement"
                                  value={requirementSelections[email.id] || ""}
                                  onChange={(e) =>
                                    setRequirementSelections((s) => ({ ...s, [email.id]: e.target.value }))
                                  }
                                  disabled={busy}
                                  style={{ width: "auto", minWidth: "9.5rem" }}
                                >
                                  <option value="">(no specific requirement)</option>
                                  {requirements.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.label}
                                    </option>
                                  ))}
                                </select>
                              </>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          <PartnerSelect
                            partners={partners}
                            value={selections[email.id] || ""}
                            onChange={(partnerId) => setSelections((s) => ({ ...s, [email.id]: partnerId }))}
                            disabled={busy}
                            style={{ width: "auto", display: "inline-block" }}
                          />
                          <span className="table-actions-as">as</span>
                          <select
                            aria-label="File kind"
                            value={kindSelections[email.id] || FILE_KINDS[0].value}
                            onChange={(e) => setKindSelections((s) => ({ ...s, [email.id]: e.target.value }))}
                            disabled={busy}
                            style={{ width: "auto", minWidth: "9.5rem" }}
                          >
                            {FILE_KINDS.map((k) => (
                              <option key={k.value} value={k.value}>
                                {k.label}
                              </option>
                            ))}
                          </select>
                          {(kindSelections[email.id] || FILE_KINDS[0].value) === "other" && (
                            <input
                              aria-label="Kind label"
                              value={customKindSelections[email.id] || ""}
                              onChange={(e) =>
                                setCustomKindSelections((s) => ({ ...s, [email.id]: e.target.value }))
                              }
                              placeholder="e.g. Background Check"
                              disabled={busy}
                              style={{ width: "10rem" }}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div className="table-actions-row">
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() => handleViewRaw(email)}
                    >
                      View raw
                    </button>
                    {canAssign && (
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy}
                        onClick={() => handleAssign(email)}
                      >
                        {busy ? "Assigning..." : "Assign"}
                      </button>
                    )}
                    {canDiscard && (
                      <button
                        type="button"
                        className="btn danger small"
                        disabled={busy}
                        onClick={() => handleDiscard(email)}
                      >
                        {busy ? "Discarding..." : "Discard"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {emails.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "#888" }}>
                Nothing waiting on review.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {confirmElement}
    </div>
  );
}
