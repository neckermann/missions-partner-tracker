import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { updateTrip, generateApplicationLink, addTripParticipant } from "../api/client.js";
import { isMinorForTrip } from "../utils/format.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import ApplicationQuestionsEditor from "../components/admin/ApplicationQuestionsEditor.jsx";
import Table from "../components/shared/Table.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import useCurrentUser from "../hooks/useCurrentUser.js";
import { TripGuestsPanel } from "../components/admin/GuestAccessPanels.jsx";
import CareTeamPanel from "../components/admin/CareTeamPanel.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import CopyButton from "../components/shared/CopyButton.jsx";

// Confirmed Team plus the recruiting pipeline that feeds it (Applications, the private link,
// this trip's application questions). Application rows open AdminTripApplicationDetail.jsx.
export default function AdminTripTeam() {
  const { trip, setTrip, applications, reload, questionLibrary, confirmDialog, navigate, id, canWrite } =
    useOutletContext();
  const { isGuest, isAdmin } = useCurrentUser();
  const { enabledFeatures } = useSettings();
  const [error, setError] = useState("");
  const [showDeclined, setShowDeclined] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ firstName: "", lastName: "", email: "" });
  // The access link for a participant just added, when Email (Sending) is off and nothing was emailed.
  const [manualAccess, setManualAccess] = useState(null);

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  async function saveQuestions(questions) {
    try {
      const updated = await updateTrip(id, { applicationQuestions: questions });
      setTrip((t) => ({ ...t, ...updated }));
      setError("");
    } catch (err) {
      reportError(err, "Couldn't save application questions.");
    }
  }

  async function handleGenerateLink() {
    try {
      const { applicationShareToken } = await generateApplicationLink(id);
      setTrip((t) => ({ ...t, applicationShareToken }));
      setError("");
    } catch (err) {
      reportError(
        err,
        "Couldn't generate link -- check that private application links are enabled in Trip settings."
      );
    }
  }

  async function handleAddParticipant() {
    if (!newParticipant.firstName) return false;
    const added = await addTripParticipant(id, newParticipant);
    setManualAccess(
      added?.teamWelcomeEmail?.manualUrl
        ? {
            name: [newParticipant.firstName, newParticipant.lastName].filter(Boolean).join(" "),
            email: newParticipant.email,
            url: added.teamWelcomeEmail.manualUrl,
          }
        : null
    );
    setNewParticipant({ firstName: "", lastName: "", email: "" });
    reload();
  }

  const fulfillmentFor = (participantId) =>
    (trip.requirements || [])
      .filter(
        (req) =>
          !req.minorsOnly ||
          isMinorForTrip(
            (trip.participants || []).find((p) => p.id === participantId)?.dateOfBirth,
            trip.startDate
          )
      )
      .map((req) => ({
        id: req.id,
        kind: req.kind,
        overdue: req.dueAt && new Date(req.dueAt) < new Date(),
        fulfilled:
          req.kind === "task"
            ? !!(req.requirementStatuses || []).find((s) => s.participantId === participantId)?.completedAt
            : (trip.documents || []).some(
                (d) => d.requirementId === req.id && d.participantId === participantId
              ),
      }));

  const pending = applications.filter((a) => a.status === "pending");
  const declined = applications.filter((a) => a.status === "declined");

  const teamColumns = [
    {
      key: "name",
      label: "Name",
      render: (p) => `${p.firstName} ${p.lastName}`,
      sortable: true,
      sortBy: (p) => `${p.lastName || ""} ${p.firstName || ""}`.toLowerCase(),
    },
    {
      key: "reach",
      label: "Phone / Email",
      render: (p) => [p.phone, p.email].filter(Boolean).join(" · ") || "—",
    },
    {
      key: "support",
      label: "Support Raising",
      render: (p) => {
        const raised = (trip.contributions || [])
          .filter((c) => c.participantId === p.id)
          .reduce((s, c) => s + c.amount, 0);
        return `$${raised}${p.supportRaisingGoal ? ` / $${p.supportRaisingGoal}` : ""}`;
      },
    },
    {
      key: "requirements",
      label: "Requirements",
      render: (p) => {
        const fulfillment = fulfillmentFor(p.id);
        if (fulfillment.length === 0) return "—";
        const done = fulfillment.filter((f) => f.fulfilled).length;
        const overdue = fulfillment.some((f) => !f.fulfilled && f.overdue);
        return (
          <span
            className={`status-pill ${done === fulfillment.length ? "ok" : overdue ? "danger" : "warn"}`}
            title={fulfillment
              .map((f, i) => `${trip.requirements[i]?.label}: ${f.fulfilled ? "done" : "missing"}`)
              .join(", ")}
          >
            {done}/{fulfillment.length} complete{overdue ? " (overdue)" : ""}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-section">
        <h3>Confirmed Team</h3>
        <Table
          columns={teamColumns}
          rows={trip.participants || []}
          onRowClick={(p) => navigate(`/admin/trips/${id}/participants/${p.id}`)}
          rowHref={(p) => `/admin/trips/${id}/participants/${p.id}`}
          emptyMessage="No one confirmed yet."
        />
        {canWrite && (
          <button
            type="button"
            className="btn secondary small"
            style={{ marginTop: "0.75rem" }}
            onClick={() => setShowAddParticipant(true)}
          >
            + Add participant directly
          </button>
        )}
      </div>

      <div className="admin-section">
        <h3>Applications awaiting review</h3>
        <Table
          columns={[
            { key: "name", label: "Name", render: (a) => `${a.firstName} ${a.lastName}` },
            { key: "createdAt", label: "Submitted", type: "date" },
          ]}
          rows={pending}
          onRowClick={(a) => navigate(`/admin/trips/${id}/applications/${a.id}`)}
          rowHref={(a) => `/admin/trips/${id}/applications/${a.id}`}
          emptyMessage="Nothing awaiting review."
        />

        {declined.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn secondary small" onClick={() => setShowDeclined((s) => !s)}>
              {showDeclined ? "Hide" : "Show"} declined ({declined.length})
            </button>
            {showDeclined && (
              <div style={{ marginTop: "0.5rem" }}>
                <Table
                  columns={[
                    { key: "name", label: "Name", render: (a) => `${a.firstName} ${a.lastName}` },
                    { key: "reviewedAt", label: "Declined", type: "date" },
                    {
                      key: "declinedReason",
                      label: "Reason",
                      render: (a) =>
                        a.declinedReason || <span style={{ color: "var(--muted)" }}>(no reason given)</span>,
                    },
                  ]}
                  rows={declined}
                  onRowClick={(a) => navigate(`/admin/trips/${id}/applications/${a.id}`)}
                  rowHref={(a) => `/admin/trips/${id}/applications/${a.id}`}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* The partner's care team: the people who keep in touch with the partner usually plan the trip. */}
      {enabledFeatures.careTeam && trip.partner?.id && (
        <CareTeamPanel partnerId={trip.partner.id} canEdit={canWrite && !isGuest} canInviteGuest={isAdmin} />
      )}

      {isAdmin && (
        <div className="admin-section">
          <h3>Guest access</h3>
          <p style={{ color: "var(--muted)" }}>
            Guests can work on this trip and see its partner, nothing else in the app. Access ends 30 days
            after the trip ends unless you set a different date.
          </p>
          <TripGuestsPanel tripId={id} />
        </div>
      )}

      <div className="admin-section">
        <h3>Private application link</h3>
        <p style={{ color: "var(--muted)" }}>
          Share this directly with specific people — never listed, never publicly discoverable. Works even for
          a restricted partner (masked).
        </p>
        {trip.applicationShareToken ? (
          <p>
            <code>{`${window.location.origin}/apply/by-token/${trip.applicationShareToken}`}</code>{" "}
            <CopyButton
              text={`${window.location.origin}/apply/by-token/${trip.applicationShareToken}`}
              label="Copy application link"
            />
          </p>
        ) : (
          <p style={{ color: "var(--muted)" }}>No link generated yet.</p>
        )}
        {/* The backend blocks this for a Trip Leader (requireRole excludes guest); hide it rather than show a misleading error. */}
        {canWrite && !isGuest && (
          <button type="button" className="btn secondary small" onClick={handleGenerateLink}>
            {trip.applicationShareToken ? "Regenerate link" : "Generate private application link"}
          </button>
        )}
      </div>

      <div className="admin-section">
        <h3>Application questions</h3>
        <p style={{ color: "var(--muted)" }}>
          Added after the church-wide questions (Settings → Trips Settings) on both the public and private
          application forms for this trip specifically.
        </p>
        {canWrite ? (
          <ApplicationQuestionsEditor
            questions={trip.applicationQuestions || []}
            onAdd={(input) =>
              saveQuestions([...(trip.applicationQuestions || []), { id: crypto.randomUUID(), ...input }])
            }
            onUpdate={(qId, patch) =>
              saveQuestions(
                (trip.applicationQuestions || []).map((q) => (q.id === qId ? { ...q, ...patch } : q))
              )
            }
            onRemove={async (qId) => {
              const confirmed = await confirmDialog({
                title: "Remove this application question?",
                body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
                confirmLabel: "Remove",
                danger: true,
              });
              if (!confirmed) return;
              await saveQuestions((trip.applicationQuestions || []).filter((q) => q.id !== qId));
            }}
            onReorder={(reordered) => saveQuestions(reordered)}
            library={questionLibrary}
            onAddFromLibrary={(entry) =>
              saveQuestions([...(trip.applicationQuestions || []), { ...entry, id: crypto.randomUUID() }])
            }
          />
        ) : (trip.applicationQuestions || []).length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No extra questions on this trip.</p>
        ) : (
          <ul>
            {(trip.applicationQuestions || []).map((q) => (
              <li key={q.id}>{q.label}</li>
            ))}
          </ul>
        )}
      </div>

      {manualAccess && (
        <ManualSendNotice
          recipients={manualAccess}
          title="Email sending isn't enabled here, so send this participant their trip link yourself"
        />
      )}

      {showAddParticipant && (
        <QuickActionModal
          title="Add Participant Directly"
          onClose={() => setShowAddParticipant(false)}
          onSubmit={handleAddParticipant}
        >
          <div className="form-grid">
            <label>
              First name
              <input
                value={newParticipant.firstName}
                onChange={(e) => setNewParticipant((f) => ({ ...f, firstName: e.target.value }))}
              />
            </label>
            <label>
              Last name
              <input
                value={newParticipant.lastName}
                onChange={(e) => setNewParticipant((f) => ({ ...f, lastName: e.target.value }))}
              />
            </label>
            <label>
              Email
              <input
                value={newParticipant.email}
                onChange={(e) => setNewParticipant((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}
    </div>
  );
}
