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
import { formatDate, isMinorForTrip } from "../utils/format.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// One participant's full picture, split out of the Trips Team page's
// Confirmed Team table (#252 follow-on). That table used to cram
// document upload, a requirement picker, task checkboxes, and access-
// link controls into one action column per row -- everything here is
// that same functionality, just given the room a person's full record
// actually needs. The Team page's Confirmed Team table still covers
// "who's on the team and what's outstanding across everyone, at a
// glance"; this page is the canonical complete record for one person.
//
// Every editable section on this page is EditableSection -- Contact &
// access, Support-raising goal, and Their Public Page (photo + story,
// the last onBlur/fire-on-select fields left on this page) all share
// the same explicit edit -> save/cancel boundary.
export default function AdminTripParticipantDetail() {
  const { tripId, participantId } = useParams();
  const { canWrite: globalCanWrite, isTripLeader, scopedTripId } = useCurrentUser();
  // Mirrors TripDetailLayout.jsx's own canWrite -- this page is a sibling
  // route, not nested under that layout's Outlet, so it can't inherit its
  // context and has to repeat the same scope check here.
  const canWrite = globalCanWrite || (isTripLeader && tripId === scopedTripId);
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [trip, setTrip] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [manualAccessLink, setManualAccessLink] = useState(null); // { url } | null
  const [docMessage, setDocMessage] = useState("");
  const [docFile, setDocFile] = useState(null);
  const [docRequirementChoice, setDocRequirementChoice] = useState("");

  const reload = useCallback(() => {
    fetchTrip(tripId).then(setTrip).catch(console.error);
  }, [tripId]);

  useEffect(() => {
    reload();
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
  const requirementRows = (trip.requirements || [])
    .filter((r) => !r.minorsOnly || isMinorForTrip(participant.dateOfBirth, trip.startDate))
    .map((r) => ({
      ...r,
      fulfilled:
        r.kind === "task"
          ? !!(r.requirementStatuses || []).find((s) => s.participantId === participantId)?.completedAt
          : documents.some((d) => d.requirementId === r.id),
    }));
  const documentRequirements = requirementRows.filter((r) => r.kind !== "task");

  const missingFields =
    trip.status !== "completed"
      ? [
          settings?.collectApplicantAddress && !participant.addressLine1 && "address",
          settings?.collectEmergencyContact && !participant.emergencyContactFirstName && "emergency contact",
          !participant.dateOfBirth && "date of birth",
          isMinorForTrip(participant.dateOfBirth, trip.startDate) &&
            !participant.parentGuardianFirstName &&
            "parent/guardian name",
        ].filter(Boolean)
      : [];

  const combinedQuestions = [
    ...(settings?.tripApplicationTemplate || []),
    ...(trip.applicationQuestions || []),
  ];
  const applicationAnswers = participant.application
    ? combinedQuestions.map((q) => {
        const raw = participant.application.responses?.[q.id];
        const answer = Array.isArray(raw) ? raw.join(", ") : raw;
        return { id: q.id, label: q.label, answer: answer || "(no answer)" };
      })
    : [];

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  async function handleGenerateSupportRaisingLink() {
    try {
      await generateSupportRaisingLink(participantId);
      reload();
      setError("");
    } catch (err) {
      reportError(
        err,
        "Couldn't generate link -- check that public support-raising links are enabled in Trip settings."
      );
    }
  }

  async function saveParticipant(fields) {
    await updateTripParticipant(participantId, fields);
    reload();
  }

  async function handleResendAccessLink() {
    try {
      const result = await resendParticipantAccessLink(participantId);
      setError("");
      setManualAccessLink(result?.manualUrl ? { url: result.manualUrl } : null);
    } catch (err) {
      reportError(err, "Couldn't resend the access link.");
    }
  }

  async function handleRequestDocuments() {
    if (!docMessage) return;
    try {
      await requestTripDocuments(tripId, participantId, docMessage);
      setDocMessage("");
      setError("");
    } catch (err) {
      reportError(err, "Couldn't send -- check that outbound and inbound email are configured.");
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
      setError("");
    } catch (err) {
      reportError(err, "Couldn't log this document.");
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
    try {
      await deleteTripDocument(docId);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't remove this document.");
    }
  }

  async function handleToggleTaskComplete(requirementId, completed) {
    try {
      await setTripRequirementComplete(requirementId, participantId, completed);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't update that task.");
    }
  }

  return (
    <div className="admin-shell">
      <Breadcrumb
        // A Trip Leader has no access to the Partners directory or a
        // cross-trip "Trips" list -- same reasoning as TripDetailLayout.jsx's
        // identically-trimmed breadcrumb.
        items={
          isTripLeader
            ? [
                ...(trip.partner?.id
                  ? [
                      {
                        label: trip.partner.displayName || "Partner",
                        to: `/admin/partners/${trip.partner.id}`,
                      },
                    ]
                  : []),
                { label: trip.name || trip.type || "Trip", to: `/admin/trips/${tripId}` },
                { label: `${participant.firstName} ${participant.lastName}` },
              ]
            : [
                { label: "Partners", to: "/admin/partners" },
                {
                  label: trip.partner?.displayName || "Partner",
                  to: `/admin/partners/${trip.partner?.id}`,
                },
                { label: "Trips", to: `/admin/trips?partnerId=${trip.partner?.id}` },
                { label: trip.name || trip.type || "Trip", to: `/admin/trips/${tripId}` },
                { label: `${participant.firstName} ${participant.lastName}` },
              ]
        }
      />
      <h2 style={{ margin: "0.5rem 0" }}>
        {participant.firstName} {participant.lastName}
      </h2>
      {error && (
        <p style={{ color: "#b91c1c" }} role="alert">
          {error}
        </p>
      )}
      {missingFields.length > 0 && (
        <p style={{ color: "#a6540f", fontSize: "0.85rem" }}>Missing: {missingFields.join(", ")}</p>
      )}

      {/* Right above "Contact & access", not up by the page title -- that's
          where "Resend access link" (below) actually lives, so the link
          this produces shows up next to the action that asked for it. */}
      {manualAccessLink && <ManualSendNotice recipients={manualAccessLink} />}
      <EditableSection
        title="Contact & access"
        canEdit={canWrite}
        value={{
          firstName: participant.firstName || "",
          lastName: participant.lastName || "",
          email: participant.email || "",
          phone: participant.phone || "",
          role: participant.role || "",
          isLeader: !!participant.isLeader,
          addressLine1: participant.addressLine1 || "",
          addressLine2: participant.addressLine2 || "",
          city: participant.city || "",
          stateProvinceRegion: participant.stateProvinceRegion || "",
          postalCode: participant.postalCode || "",
          country: participant.country || "",
          emergencyContactFirstName: participant.emergencyContactFirstName || "",
          emergencyContactLastName: participant.emergencyContactLastName || "",
          emergencyContactPhone: participant.emergencyContactPhone || "",
          emergencyContactEmail: participant.emergencyContactEmail || "",
          dateOfBirth: participant.dateOfBirth ? participant.dateOfBirth.slice(0, 10) : "",
          parentGuardianFirstName: participant.parentGuardianFirstName || "",
          parentGuardianLastName: participant.parentGuardianLastName || "",
          parentGuardianRelationship: participant.parentGuardianRelationship || "",
          parentGuardianPhone: participant.parentGuardianPhone || "",
          parentGuardianEmail: participant.parentGuardianEmail || "",
        }}
        onSave={(draft) =>
          saveParticipant({
            firstName: draft.firstName.trim(),
            lastName: draft.lastName.trim() || null,
            email: draft.email.trim() || null,
            phone: draft.phone.trim() || null,
            role: draft.role.trim() || null,
            isLeader: draft.isLeader,
            addressLine1: draft.addressLine1.trim() || null,
            addressLine2: draft.addressLine2.trim() || null,
            city: draft.city.trim() || null,
            stateProvinceRegion: draft.stateProvinceRegion.trim() || null,
            postalCode: draft.postalCode.trim() || null,
            country: draft.country.trim() || null,
            emergencyContactFirstName: draft.emergencyContactFirstName.trim() || null,
            emergencyContactLastName: draft.emergencyContactLastName.trim() || null,
            emergencyContactPhone: draft.emergencyContactPhone.trim() || null,
            emergencyContactEmail: draft.emergencyContactEmail.trim() || null,
            dateOfBirth: draft.dateOfBirth || null,
            parentGuardianFirstName: draft.parentGuardianFirstName.trim() || null,
            parentGuardianLastName: draft.parentGuardianLastName.trim() || null,
            parentGuardianRelationship: draft.parentGuardianRelationship.trim() || null,
            parentGuardianPhone: draft.parentGuardianPhone.trim() || null,
            parentGuardianEmail: draft.parentGuardianEmail.trim() || null,
          })
        }
        actions={
          canWrite && (
            <>
              <button type="button" className="btn secondary small" onClick={handleResendAccessLink}>
                Resend access link
              </button>
              {settings?.allowPublicSupportRaisingLinks && (
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={handleGenerateSupportRaisingLink}
                >
                  {participant.shareToken
                    ? "Regenerate support-raising link"
                    : "Generate support-raising link"}
                </button>
              )}
            </>
          )
        }
        view={(v) => (
          <div>
            <div className="form-grid">
              <ViewField label="First name" value={v.firstName} />
              <ViewField label="Last name" value={v.lastName} />
              <ViewField label="Email" value={v.email} />
              <ViewField label="Phone" value={v.phone} />
              <ViewField label="Role" value={v.role} />
              <ViewField
                label="Team Leader"
                value={
                  <StatusPill label={v.isLeader ? "Yes" : "No"} color={v.isLeader ? "#2a5d3c" : "#6b6f76"} />
                }
              />
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Address</h4>
            <div className="form-grid">
              <ViewField label="Address line 1" value={v.addressLine1} />
              <ViewField label="Address line 2" value={v.addressLine2} />
              <ViewField label="City" value={v.city} />
              <ViewField label="State / Province / Region" value={v.stateProvinceRegion} />
              <ViewField label="Postal code" value={v.postalCode} />
              <ViewField label="Country" value={v.country} />
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Emergency contact</h4>
            <div className="form-grid">
              <ViewField label="First Name" value={v.emergencyContactFirstName} />
              <ViewField label="Last Name" value={v.emergencyContactLastName} />
              <ViewField label="Phone" value={v.emergencyContactPhone} />
              <ViewField label="Email" value={v.emergencyContactEmail} />
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Date of birth</h4>
            <div className="form-grid">
              <ViewField label="Date of birth" value={v.dateOfBirth} />
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Parent/guardian</h4>
            <div className="form-grid">
              <ViewField label="Parent/guardian first name" value={v.parentGuardianFirstName} />
              <ViewField label="Parent/guardian last name" value={v.parentGuardianLastName} />
              <ViewField label="Relationship" value={v.parentGuardianRelationship} />
              <ViewField label="Parent/guardian phone" value={v.parentGuardianPhone} />
              <ViewField label="Parent/guardian email" value={v.parentGuardianEmail} />
            </div>
          </div>
        )}
        edit={(draft, set) => (
          <div>
            <div className="form-grid">
              <label>
                First name
                <input value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </label>
              <label>
                Last name
                <input value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </label>
              <label>
                Email
                <input value={draft.email} onChange={(e) => set("email", e.target.value)} />
              </label>
              <label>
                Phone
                <input value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
              </label>
              <label>
                Role
                <input
                  value={draft.role}
                  placeholder="e.g. Medical, Construction, Translator"
                  onChange={(e) => set("role", e.target.value)}
                />
              </label>
              <label style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={draft.isLeader}
                  onChange={(e) => set("isLeader", e.target.checked)}
                />
                Team Leader
              </label>
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Address</h4>
            <div className="form-grid">
              <label>
                Address line 1
                <input value={draft.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
              </label>
              <label>
                Address line 2
                <input value={draft.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
              </label>
              <label>
                City
                <input value={draft.city} onChange={(e) => set("city", e.target.value)} />
              </label>
              <label>
                State / Province / Region
                <input
                  value={draft.stateProvinceRegion}
                  onChange={(e) => set("stateProvinceRegion", e.target.value)}
                />
              </label>
              <label>
                Postal code
                <input value={draft.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
              </label>
              <label>
                Country
                <input value={draft.country} onChange={(e) => set("country", e.target.value)} />
              </label>
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Emergency contact</h4>
            <div className="form-grid">
              <label>
                First Name
                <input
                  value={draft.emergencyContactFirstName}
                  onChange={(e) => set("emergencyContactFirstName", e.target.value)}
                />
              </label>
              <label>
                Last Name
                <input
                  value={draft.emergencyContactLastName}
                  onChange={(e) => set("emergencyContactLastName", e.target.value)}
                />
              </label>
              <label>
                Phone
                <input
                  value={draft.emergencyContactPhone}
                  onChange={(e) => set("emergencyContactPhone", e.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  value={draft.emergencyContactEmail}
                  onChange={(e) => set("emergencyContactEmail", e.target.value)}
                />
              </label>
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Date of birth</h4>
            <div className="form-grid">
              <label>
                Date of birth
                <input
                  type="date"
                  value={draft.dateOfBirth}
                  onChange={(e) => set("dateOfBirth", e.target.value)}
                />
              </label>
            </div>
            <h4 style={{ margin: "0.75rem 0 0.4rem" }}>Parent/guardian</h4>
            <div className="form-grid">
              <label>
                Parent/guardian first name
                <input
                  value={draft.parentGuardianFirstName}
                  onChange={(e) => set("parentGuardianFirstName", e.target.value)}
                />
              </label>
              <label>
                Parent/guardian last name
                <input
                  value={draft.parentGuardianLastName}
                  onChange={(e) => set("parentGuardianLastName", e.target.value)}
                />
              </label>
              <label>
                Relationship
                <input
                  value={draft.parentGuardianRelationship}
                  placeholder="e.g. Mother, Father, Legal guardian"
                  onChange={(e) => set("parentGuardianRelationship", e.target.value)}
                />
              </label>
              <label>
                Parent/guardian phone
                <input
                  value={draft.parentGuardianPhone}
                  onChange={(e) => set("parentGuardianPhone", e.target.value)}
                />
              </label>
              <label>
                Parent/guardian email
                <input
                  value={draft.parentGuardianEmail}
                  onChange={(e) => set("parentGuardianEmail", e.target.value)}
                />
              </label>
            </div>
          </div>
        )}
      />

      {participant.application && (
        <div className="admin-section">
          <h3>Application answers</h3>
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

      <EditableSection
        title="Support raising"
        canEdit={canWrite}
        value={{ supportRaisingGoal: participant.supportRaisingGoal ?? "" }}
        onSave={(draft) =>
          saveParticipant({
            supportRaisingGoal: draft.supportRaisingGoal === "" ? null : Number(draft.supportRaisingGoal),
          })
        }
        view={(v) => (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontWeight: 600,
              }}
            >
              <span>${raised} raised</span>
              <span>of ${v.supportRaisingGoal || 0} goal</span>
            </div>
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
        )}
        edit={(draft, set) => (
          <label style={{ maxWidth: 220 }}>
            Support-raising goal ($)
            <input
              type="number"
              value={draft.supportRaisingGoal}
              onChange={(e) => set("supportRaisingGoal", e.target.value)}
            />
          </label>
        )}
      />

      {settings?.allowPublicSupportRaisingLinks && participant.shareToken && (
        <div style={{ marginTop: "1rem" }}>
          <EditableSection
            title="Their Public Page"
            canEdit={canWrite}
            value={{ story: participant.story || "", photoDataUrl: null, photoContentType: null }}
            onSave={(draft) =>
              saveParticipant({
                story: draft.story,
                ...(draft.photoDataUrl
                  ? { photo: draft.photoDataUrl, photoContentType: draft.photoContentType }
                  : {}),
              })
            }
            view={() => (
              <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                {participant.photoContentType && (
                  <img
                    src={tripParticipantPhotoUrl(participant.id)}
                    alt={`${participant.firstName} ${participant.lastName}`}
                    style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }}
                  />
                )}
                <p style={{ flex: 1, minWidth: 220 }}>{participant.story || "No story set"}</p>
              </div>
            )}
            edit={(draft, set) => (
              <>
                <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                  {(draft.photoDataUrl || participant.photoContentType) && (
                    <img
                      src={draft.photoDataUrl || tripParticipantPhotoUrl(participant.id)}
                      alt={`${participant.firstName} ${participant.lastName}`}
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
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        set("photoDataUrl", await readFileAsDataUrl(file));
                        set("photoContentType", file.type);
                      }}
                    />
                  </div>
                </div>
                <label style={{ display: "block", marginTop: "0.6rem" }}>
                  Story (what shows on their public page)
                  <textarea rows={3} value={draft.story} onChange={(e) => set("story", e.target.value)} />
                </label>
              </>
            )}
          />
        </div>
      )}

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
                        disabled={!canWrite}
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
              {canWrite && (
                <button type="button" className="btn-remove" onClick={() => handleDeleteDocument(d.id)}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {documents.length === 0 && <p style={{ color: "#888" }}>No documents on file yet.</p>}
        </ul>

        {canWrite && (
          <>
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
          </>
        )}
      </div>
      {confirmElement}
    </div>
  );
}

function ViewField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "#888", fontWeight: 600 }}>{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}
