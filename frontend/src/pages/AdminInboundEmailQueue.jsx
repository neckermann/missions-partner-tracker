import React, { useEffect, useState } from "react";
import {
  fetchPendingInboundEmails,
  assignInboundEmail,
  discardInboundEmail,
  fetchPartners,
  fetchTrips,
} from "../api/client.js";
import PartnerSelect from "../components/admin/PartnerSelect.jsx";
import TripParticipantSelect from "../components/admin/TripParticipantSelect.jsx";
import { FILE_KINDS } from "../utils/fileKinds.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import Table from "../components/shared/Table.jsx";
import Modal from "../components/Modal.jsx";

// The review queue for inbound emails the webhook (see routes/inboundEmail.js)
// couldn't automatically match to exactly one partner -- zero matches, or
// more than one distinct partner sharing the sender address. A standing,
// independently-paginated queue an admin returns to over time -- same
// Table -> row click opens a Modal shape AdminPendingDispatches.jsx
// already uses for this identical kind of queue.
//
// A row's mere existence means "pending" -- there's no status field (see
// the InboundEmail model comment in schema.prisma), so both assign and
// discard just remove the row.
export default function AdminInboundEmailQueue() {
  const { enabledFeatures } = useSettings();
  const [emails, setEmails] = useState([]);
  const [partners, setPartners] = useState([]);
  const [trips, setTrips] = useState([]);
  const { canWrite: canAssign, isAdmin: canDiscard } = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assigning, setAssigning] = useState(null); // { email, mode, partnerId, participantId, requirementId, kind, customKind }
  const [busy, setBusy] = useState(false);
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

  function openAssign(email) {
    setError("");
    setAssigning({
      email,
      mode: "partner",
      partnerId: "",
      participantId: "",
      requirementId: "",
      kind: FILE_KINDS[0].value,
      customKind: "",
    });
  }

  function updateAssigning(patch) {
    setAssigning((a) => ({ ...a, ...patch }));
  }

  async function handleAssign() {
    const a = assigning;
    if (a.mode === "participant") {
      if (!a.participantId) {
        setError("Choose a trip participant before assigning.");
        return;
      }
      setError("");
      setBusy(true);
      try {
        await assignInboundEmail(a.email.id, {
          tripParticipantId: a.participantId,
          requirementId: a.requirementId || null,
        });
        setAssigning(null);
        await reload();
      } catch (err) {
        setError(err.response?.data?.error || "Couldn't assign this email.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!a.partnerId) {
      setError("Choose a partner before assigning.");
      return;
    }
    if (a.kind === "other" && !a.customKind.trim()) {
      setError('Enter a kind label before assigning as "Other".');
      return;
    }
    setError("");
    setBusy(true);
    try {
      await assignInboundEmail(a.email.id, {
        partnerId: a.partnerId,
        kind: a.kind,
        customKind: a.customKind,
      });
      setAssigning(null);
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't assign this email.");
    } finally {
      setBusy(false);
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
    setBusy(true);
    try {
      await discardInboundEmail(email.id);
      setAssigning(null);
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't discard this email.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  const columns = [
    { key: "fromAddress", label: "From", sortable: true },
    { key: "subject", label: "Subject", render: (e) => e.subject || "—" },
    { key: "receivedAt", label: "Received", type: "date", sortable: true },
  ];

  return (
    <div className="admin-shell">
      <h2>Unmatched Emails</h2>
      <p style={{ color: "#555" }}>
        Inbound emails that couldn't be automatically matched to exactly one partner -- either no partner's
        contact or household-adult email matched the sender, or more than one did. Assign each to the right
        partner, picking what kind of file it actually is -- or, if trips are on, to a trip participant
        instead, optionally marking which document requirement it fulfills -- or discard it.
      </p>

      {error && !assigning && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <Table
        columns={columns}
        rows={emails}
        onRowClick={canAssign ? openAssign : undefined}
        emptyMessage="Nothing waiting on review."
        renderActions={(email) => (
          <>
            <button type="button" className="btn secondary small" onClick={() => handleViewRaw(email)}>
              View raw
            </button>
            {canDiscard && (
              <button type="button" className="btn danger small" onClick={() => handleDiscard(email)}>
                Discard
              </button>
            )}
          </>
        )}
      />

      {assigning && (
        <Modal title={`Assign email from ${assigning.email.fromAddress}`} onClose={() => setAssigning(null)}>
          <p style={{ color: "#555", fontSize: "0.85rem" }}>
            Subject: {assigning.email.subject || "—"} · Received{" "}
            {new Date(assigning.email.receivedAt).toLocaleString()}
          </p>

          {trips.length > 0 && (
            <label>
              Assign to
              <select
                value={assigning.mode}
                onChange={(e) => updateAssigning({ mode: e.target.value })}
                disabled={busy}
              >
                <option value="partner">Partner</option>
                <option value="participant">Trip participant</option>
              </select>
            </label>
          )}

          {assigning.mode === "participant" ? (
            <>
              <div style={{ marginTop: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                  Trip participant
                </span>
                <TripParticipantSelect
                  aria-label="Trip participant"
                  trips={trips}
                  value={assigning.participantId}
                  onChange={(participantId) => updateAssigning({ participantId, requirementId: "" })}
                  disabled={busy}
                />
              </div>
              {(() => {
                const trip = trips.find((t) =>
                  (t.participants || []).some((p) => p.id === assigning.participantId)
                );
                // Only a "document" requirement is something an inbound
                // email attachment could ever fulfill -- a "task" has
                // nothing to attach a file to.
                const requirements = (trip?.requirements || []).filter((r) => r.kind !== "task");
                if (!assigning.participantId || requirements.length === 0) return null;
                return (
                  <label style={{ marginTop: "0.75rem" }}>
                    Fulfilling (optional)
                    <select
                      value={assigning.requirementId}
                      onChange={(e) => updateAssigning({ requirementId: e.target.value })}
                      disabled={busy}
                    >
                      <option value="">(no specific requirement)</option>
                      {requirements.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })()}
            </>
          ) : (
            <>
              <label style={{ marginTop: "0.75rem" }}>
                Partner
                <PartnerSelect
                  partners={partners}
                  value={assigning.partnerId}
                  onChange={(partnerId) => updateAssigning({ partnerId })}
                  disabled={busy}
                />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                File kind
                <select
                  value={assigning.kind}
                  onChange={(e) => updateAssigning({ kind: e.target.value })}
                  disabled={busy}
                >
                  {FILE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              {assigning.kind === "other" && (
                <label style={{ marginTop: "0.75rem" }}>
                  Kind label
                  <input
                    value={assigning.customKind}
                    onChange={(e) => updateAssigning({ customKind: e.target.value })}
                    placeholder="e.g. Background Check"
                    disabled={busy}
                  />
                </label>
              )}
            </>
          )}

          {error && (
            <p className="form-error" role="alert" style={{ marginTop: "0.75rem" }}>
              {error}
            </p>
          )}

          <div className="table-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn small" disabled={busy} onClick={handleAssign}>
              {busy ? "Assigning..." : "Assign"}
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => handleViewRaw(assigning.email)}
            >
              View raw
            </button>
          </div>
        </Modal>
      )}
      {confirmElement}
    </div>
  );
}
