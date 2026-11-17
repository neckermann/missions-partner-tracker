import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchTrip,
  fetchTripsSettings,
  generateSupportRaisingLink,
  resendParticipantAccessLink,
  requestTripDocuments,
  uploadTripDocument,
  deleteTripDocument,
  setTripRequirementComplete,
  updateTripParticipant,
  tripParticipantPhotoUrl,
} from "../api/client.js";
import { formatDate } from "../utils/format.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// One participant's full picture, split out of AdminTripDetail.jsx's
// Roster table (#252 follow-on). That table used to cram document
// upload, a requirement picker, task checkboxes, and access-link
// controls into one action column per row -- everything here is that
// same functionality, just given the room a person's full record
// actually needs instead of fighting a flat table row for space.
// AdminTripDetail.jsx's Confirmed Team table still covers "who's on the
// team and what's outstanding across everyone, at a glance"; this page
// is the canonical complete record for one person -- every scalar
// column TripParticipant/TripApplication carries is meant to have a
// home here (enforced by test/routes/tripFieldVisibility.test.js, not
// just this comment -- a column with no UI home by design needs the
// explicit `// tripFieldVisibility: intentionally admin-invisible`
// marker next to it in schema.prisma, not a silent gap).
export default function AdminTripParticipantDetail() {
  const { tripId, participantId } = useParams();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [trip, setTrip] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [docMessage, setDocMessage] = useState("");
  const [docFile, setDocFile] = useState(null);
  const [docRequirementChoice, setDocRequirementChoice] = useState("");
  const [storyDraft, setStoryDraft] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);

  const reload = useCallback(() => {
    fetchTrip(tripId).then(setTrip).catch(console.error);
  }, [tripId]);

  useEffect(() => {
    reload();
    // Needed just for allowPublicSupportRaisingLinks -- whether the
    // story/photo-edit controls and the public-page preview link exist
    // at all (same "doesn't render, not disabled" treatment
    // enableTripBudgeting already established elsewhere in this app).
    fetchTripsSettings().then(setSettings).catch(console.error);
  }, [reload]);

  if (!trip) return <div className="admin-shell">Loading…</div>;

  const participant = (trip.participants || []).find((p) => p.id === participantId);
  if (!participant) {
    return (
      <div className="admin-shell">
        <Link to={`/admin/trips/${tripId}`}>← Back to trip</Link>
        <p>This participant couldn't be found on this trip.</p>
      </div>
    );
  }

  const documents = (trip.documents || []).filter((d) => d.participantId === participantId);
  const contributions = (trip.contributions || []).filter((c) => c.participantId === participantId);
  const raised = contributions.reduce((sum, c) => sum + c.amount, 0);
  const requirementRows = (trip.requirements || []).map((r) => ({
    ...r,
    fulfilled:
      r.kind === "task"
        ? !!(r.requirementStatuses || []).find((s) => s.participantId === participantId)?.completedAt
        : documents.some((d) => d.requirementId === r.id),
  }));
  const documentRequirements = requirementRows.filter((r) => r.kind !== "task");

  // Narrower than a blanket completeness check -- firstName/lastName/
  // email are now required at creation for anyone added to a non-
  // completed trip (backend/src/routes/trips.js), so there's nothing
  // left to flag there. Address/emergency contact stay legitimately
  // optional-or-not based on the church's own collection toggles, not
  // on whether this participant is a backfill -- the one residual case
  // this can't catch at creation time is a toggle turned on *after*
  // someone already applied, which this banner exists to surface.
  // Never shown on a completed trip -- there's no one left to chase.
  const missingFields =
    trip.status !== "completed"
      ? [
          settings?.collectApplicantAddress && !participant.addressLine1 && "address",
          settings?.collectEmergencyContact && !participant.emergencyContactName && "emergency contact",
        ].filter(Boolean)
      : [];

  // Same combined order AdminTripDetail.jsx's own pending-applications
  // review list uses (template questions first, then this trip's own) --
  // a church can define totally different questions trip to trip, so this
  // can't be hardcoded. Only ever populated for a participant who came
  // through an approved application; null for a directly-admin-added or
  // historical-backfill participant, same as every address/emergency-
  // contact field above.
  const combinedQuestions = [...(settings?.tripApplicationTemplate || []), ...(trip.applicationQuestions || [])];
  const applicationAnswers = participant.application
    ? combinedQuestions.map((q) => {
        const raw = participant.application.responses?.[q.id];
        const answer = Array.isArray(raw) ? raw.join(", ") : raw;
        return { id: q.id, label: q.label, answer: answer || "(no answer)" };
      })
    : [];

  async function handleGenerateSupportRaisingLink() {
    try {
      await generateSupportRaisingLink(participantId);
      reload();
    } catch (err) {
      setError(
        err.response?.data?.error ||
          "Couldn't generate link -- check that public support-raising links are enabled in Trip settings."
      );
    }
  }

  // Contact details -- always available, independent of whether the
  // church uses public support-raising pages at all (plain record-
  // keeping, not gated on allowPublicSupportRaisingLinks).
  async function saveParticipant(fields) {
    try {
      await updateTripParticipant(participantId, fields);
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save.");
    }
  }

  // Story/photo -- admin editing the same fields a participant could
  // also self-edit, no review step (same as the participant's own
  // edit), gated on allowPublicSupportRaisingLinks by the caller.
  async function handleSaveStory() {
    if (storyDraft === null) return;
    await saveParticipant({ story: storyDraft });
    setStoryDraft(null);
  }

  async function handlePhotoChange(file) {
    if (!file) return;
    setPhotoFile(file);
    const dataUrl = await readFileAsDataUrl(file);
    await saveParticipant({ photo: dataUrl, photoContentType: file.type });
    setPhotoFile(null);
  }

  async function handleResendAccessLink() {
    await resendParticipantAccessLink(participantId);
  }

  async function handleRequestDocuments() {
    if (!docMessage) return;
    try {
      await requestTripDocuments(tripId, participantId, docMessage);
      setDocMessage("");
    } catch (err) {
      setError(
        err.response?.data?.error || "Couldn't send -- check that outbound and inbound email are configured."
      );
    }
  }

  async function handleLogDocument() {
    if (!docFile) return;
    try {
      await uploadTripDocument(tripId, docFile, {
        participantId,
        requirementId: docRequirementChoice || null,
      });
      setDocFile(null);
      setDocRequirementChoice("");
      reload();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't log this document.");
    }
  }

  function handleViewDocument(doc) {
    window.open(`/api/trips/documents/${doc.id}/download`, "_blank");
  }

  async function handleDeleteDocument(docId) {
    const confirmed = await confirmDialog({
      title: "Remove this document?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    await deleteTripDocument(docId);
    reload();
  }

  async function handleToggleTaskComplete(requirementId, completed) {
    await setTripRequirementComplete(requirementId, participantId, completed);
    reload();
  }

  return (
    <div className="admin-shell">
      <Link to={`/admin/trips/${tripId}`}>← Back to {trip.name || trip.type || "trip"}</Link>
      <h2 style={{ margin: "0.5rem 0" }}>
        {participant.firstName} {participant.lastName}
      </h2>
      {error && (
        <p style={{ color: "#b91c1c" }} role="alert">
          {error}
        </p>
      )}
      {missingFields.length > 0 && (
        <p style={{ color: "#a6540f", fontSize: "0.85rem" }}>
          Missing: {missingFields.join(", ")}
        </p>
      )}

      <div className="admin-section">
        <h3>Contact &amp; access</h3>
        {/* Previously read-only everywhere on this page -- a participant
        entered via a quick admin-add, or whose details changed, had no
        way to be corrected. Always available, independent of
        allowPublicSupportRaisingLinks -- plain record-keeping. */}
        <div className="form-grid">
          <label>
            First name
            <input
              key={`firstName-${participant.id}`}
              defaultValue={participant.firstName || ""}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== (participant.firstName || "") &&
                saveParticipant({ firstName: e.target.value.trim() })
              }
            />
          </label>
          <label>
            Last name
            <input
              key={`lastName-${participant.id}`}
              defaultValue={participant.lastName || ""}
              onBlur={(e) =>
                e.target.value !== (participant.lastName || "") &&
                saveParticipant({ lastName: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Email
            <input
              key={`email-${participant.id}`}
              defaultValue={participant.email || ""}
              onBlur={(e) =>
                e.target.value !== (participant.email || "") &&
                saveParticipant({ email: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Phone
            <input
              key={`phone-${participant.id}`}
              defaultValue={participant.phone || ""}
              onBlur={(e) =>
                e.target.value !== (participant.phone || "") &&
                saveParticipant({ phone: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Role
            <input
              key={`role-${participant.id}`}
              defaultValue={participant.role || ""}
              placeholder="e.g. Medical, Construction, Translator"
              onBlur={(e) =>
                e.target.value !== (participant.role || "") &&
                saveParticipant({ role: e.target.value.trim() || null })
              }
            />
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={!!participant.isLeader}
              onChange={(e) => saveParticipant({ isLeader: e.target.checked })}
            />
            Trip Leader
          </label>
        </div>

        <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Address</h4>
        <div className="form-grid">
          <label>
            Address line 1
            <input
              key={`addressLine1-${participant.id}`}
              defaultValue={participant.addressLine1 || ""}
              onBlur={(e) =>
                e.target.value !== (participant.addressLine1 || "") &&
                saveParticipant({ addressLine1: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Address line 2
            <input
              key={`addressLine2-${participant.id}`}
              defaultValue={participant.addressLine2 || ""}
              onBlur={(e) =>
                e.target.value !== (participant.addressLine2 || "") &&
                saveParticipant({ addressLine2: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            City
            <input
              key={`city-${participant.id}`}
              defaultValue={participant.city || ""}
              onBlur={(e) =>
                e.target.value !== (participant.city || "") &&
                saveParticipant({ city: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            State / Province / Region
            <input
              key={`stateProvinceRegion-${participant.id}`}
              defaultValue={participant.stateProvinceRegion || ""}
              onBlur={(e) =>
                e.target.value !== (participant.stateProvinceRegion || "") &&
                saveParticipant({ stateProvinceRegion: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Postal code
            <input
              key={`postalCode-${participant.id}`}
              defaultValue={participant.postalCode || ""}
              onBlur={(e) =>
                e.target.value !== (participant.postalCode || "") &&
                saveParticipant({ postalCode: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Country
            <input
              key={`country-${participant.id}`}
              defaultValue={participant.country || ""}
              onBlur={(e) =>
                e.target.value !== (participant.country || "") &&
                saveParticipant({ country: e.target.value.trim() || null })
              }
            />
          </label>
        </div>

        <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Emergency contact</h4>
        <div className="form-grid">
          <label>
            Name
            <input
              key={`emergencyContactName-${participant.id}`}
              defaultValue={participant.emergencyContactName || ""}
              onBlur={(e) =>
                e.target.value !== (participant.emergencyContactName || "") &&
                saveParticipant({ emergencyContactName: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Phone
            <input
              key={`emergencyContactPhone-${participant.id}`}
              defaultValue={participant.emergencyContactPhone || ""}
              onBlur={(e) =>
                e.target.value !== (participant.emergencyContactPhone || "") &&
                saveParticipant({ emergencyContactPhone: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Email
            <input
              key={`emergencyContactEmail-${participant.id}`}
              defaultValue={participant.emergencyContactEmail || ""}
              onBlur={(e) =>
                e.target.value !== (participant.emergencyContactEmail || "") &&
                saveParticipant({ emergencyContactEmail: e.target.value.trim() || null })
              }
            />
          </label>
        </div>

        <div className="table-actions" style={{ marginTop: "0.5rem" }}>
          <button type="button" className="btn secondary small" onClick={handleResendAccessLink}>
            Resend access link
          </button>
          {/* "Regenerate" now, always available while the setting is on --
          previously vanished forever once a token existed, with no way
          to rotate a leaked link. Overwrite-as-revocation (the backend
          route already just overwrites) is enough, same precedent
          Trip.applicationShareToken's own regenerate already uses. */}
          {settings?.allowPublicSupportRaisingLinks && (
            <button type="button" className="btn secondary small" onClick={handleGenerateSupportRaisingLink}>
              {participant.shareToken ? "Regenerate support-raising link" : "Generate support-raising link"}
            </button>
          )}
        </div>
      </div>

      {participant.application && (
        <div className="admin-section">
          <h3>Application answers</h3>
          {/* Read-only -- this is the applicant's own record of what they
          answered at submission time, not something an admin corrects
          here. Submitted {formatDate(...)} gives a reference point, since
          a trip's own question set can change after someone applied. */}
          <p style={{ fontSize: "0.8rem", color: "#888", marginTop: 0 }}>
            Submitted {formatDate(participant.application.submittedAt)}
          </p>
          {applicationAnswers.length === 0 ? (
            <p style={{ color: "#888", fontSize: "0.85rem" }}>This trip has no application questions set.</p>
          ) : (
            <dl style={{ margin: 0 }}>
              {applicationAnswers.map((q) => (
                <div key={q.id} style={{ marginBottom: "0.4rem" }}>
                  <dt style={{ fontSize: "0.85rem", fontWeight: 600 }}>{q.label}</dt>
                  <dd style={{ margin: "0.1rem 0 0", fontSize: "0.85rem", color: "#333" }}>{q.answer}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      <div className="admin-section">
        <h3>Support raising</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600 }}>
          <span>${raised} raised</span>
          <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem", fontWeight: 400 }}>
            <span style={{ color: "#6b6f76" }}>of $</span>
            <input
              key={`supportRaisingGoal-${participant.id}`}
              type="number"
              style={{ width: "5.5rem" }}
              defaultValue={participant.supportRaisingGoal || ""}
              onBlur={(e) =>
                Number(e.target.value || 0) !== (participant.supportRaisingGoal || 0) &&
                saveParticipant({ supportRaisingGoal: e.target.value ? Number(e.target.value) : null })
              }
            />
            <span style={{ color: "#6b6f76" }}>goal</span>
          </label>
        </div>
        {/* Same "doesn't exist, not disabled" treatment enableTripBudgeting
        already established -- when the setting's off, or this specific
        participant doesn't have a shareToken yet, there's no real public
        page for any of this to be about, so none of it renders at all. */}
        {settings?.allowPublicSupportRaisingLinks && participant.shareToken && (
          <>
            <p style={{ fontSize: "0.75rem", marginTop: "0.4rem" }}>
              <code>{`${window.location.origin}/trip-support-raising/${participant.shareToken}`}</code>{" "}
              <a
                href={`${window.location.origin}/trip-support-raising/${participant.shareToken}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Preview their public page →
              </a>
            </p>

            <div style={{ marginTop: "0.75rem" }}>
              <h4 style={{ margin: "0 0 0.4rem" }}>Their public page</h4>
              <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                {participant.photoContentType && (
                  <img
                    src={tripParticipantPhotoUrl(participant.id)}
                    alt={`Photo of ${participant.firstName} ${participant.lastName}`}
                    style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                    Photo of {participant.firstName} (shown on their public page)
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label={`Photo of ${participant.firstName} ${participant.lastName}`}
                    onChange={(e) => handlePhotoChange(e.target.files[0] || null)}
                  />
                  {photoFile && <span style={{ fontSize: "0.75rem", color: "#888" }}> Uploading…</span>}
                </div>
              </div>
              <label style={{ display: "block", marginTop: "0.6rem" }}>
                Story (what shows on their public page)
                <textarea
                  rows={3}
                  defaultValue={participant.story || ""}
                  onChange={(e) => setStoryDraft(e.target.value)}
                  onBlur={handleSaveStory}
                />
              </label>
            </div>
          </>
        )}
        {contributions.length > 0 && (
          <table className="admin-table" style={{ marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th>Donor</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => (
                <tr key={c.id}>
                  <td>{c.donorName}</td>
                  <td>${c.amount}</td>
                  <td>{c.method}</td>
                  <td>{formatDate(c.receivedDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-section">
        <h3>Requirements</h3>
        {requirementRows.length === 0 ? (
          <p style={{ color: "#888" }}>This trip has no requirements defined.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {requirementRows.map((r) => (
              <li
                key={r.id}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}
              >
                {r.kind === "task" ? (
                  <div className="admin-checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={r.fulfilled}
                        onChange={(e) => handleToggleTaskComplete(r.id, e.target.checked)}
                      />
                      {r.label}
                    </label>
                  </div>
                ) : (
                  <span>
                    {r.fulfilled ? "✅" : "⬜"} {r.label}
                  </span>
                )}
                {r.dueAt && new Date(r.dueAt) < new Date() && !r.fulfilled && (
                  <span style={{ color: "#b91c1c", fontWeight: 600, fontSize: "0.8rem" }}>overdue</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-section">
        <h3>Documents</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {documents.map((d) => (
            <li key={d.id} style={{ marginBottom: "0.3rem" }}>
              {d.title || d.fileName}{" "}
              <button type="button" className="btn secondary small" onClick={() => handleViewDocument(d)}>
                View
              </button>{" "}
              <button type="button" className="btn-remove" onClick={() => handleDeleteDocument(d.id)}>
                ✕
              </button>
            </li>
          ))}
          {documents.length === 0 && <p style={{ color: "#888" }}>No documents on file yet.</p>}
        </ul>

        <div style={{ marginTop: "0.75rem" }}>
          <input
            style={{ width: 260 }}
            placeholder="Document request message"
            value={docMessage}
            onChange={(e) => setDocMessage(e.target.value)}
          />
          <button
            type="button"
            className="btn secondary small"
            onClick={handleRequestDocuments}
            style={{ marginLeft: "0.5rem" }}
          >
            Request documents
          </button>
        </div>

        <div style={{ marginTop: "0.5rem" }}>
          {/* Manually log a document received by any means other than inbound
          email (which already files straight to a participant via the
          Unmatched Emails queue) -- mail, in person, a file the admin
          already has. */}
          <input
            type="file"
            aria-label="Document file"
            onChange={(e) => setDocFile(e.target.files[0] || null)}
          />
          {documentRequirements.length > 0 && (
            <select
              aria-label="Fulfills requirement"
              value={docRequirementChoice}
              onChange={(e) => setDocRequirementChoice(e.target.value)}
              style={{ margin: "0 0.5rem" }}
            >
              <option value="">(no specific requirement)</option>
              {documentRequirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn secondary small"
            disabled={!docFile}
            onClick={handleLogDocument}
          >
            Log document
          </button>
        </div>
      </div>
      {confirmElement}
    </div>
  );
}
