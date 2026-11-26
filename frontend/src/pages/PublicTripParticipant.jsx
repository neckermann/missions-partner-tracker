import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import {
  fetchPublicTripParticipantByToken,
  fetchTripParticipantSelfService,
  signTripRequirement,
  uploadTripRequirementDocument,
  updateTripParticipantSelfService,
  tripParticipantPhotoUrl,
  tripDocumentDownloadUrl,
  tripMeetingIcsUrl,
  tripMeetingRsvpUrl,
} from "../api/client.js";
import { formatDate, formatFileSize } from "../utils/format.js";
import SignatureCapture from "../components/SignatureCapture.jsx";
import { buildCalendarLinks, meetingDescription } from "../utils/calendarLinks.js";
import CopyButton from "../components/shared/CopyButton.jsx";

// Same wording as the email invite's own RSVP links (backend/src/utils/tripEmails.js).
const RSVP_LABELS = { yes: "Yes", no: "No", maybe: "Maybe" };

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Serves the public support-raising view (by shareToken, /trip-support-raising/:shareToken) and the
// participant's self-service view (by signed access token, /my-trip?token=...). The public view never
// shows flightSegments or donor contact info; the self-service view shows both.

// Per-meeting "add to calendar" links: web links for Google/Outlook/Yahoo (work on a phone with no .ics
// handler) plus the .ics download for Apple Calendar and others.
function AddToCalendar({ meeting, accessToken }) {
  const links = buildCalendarLinks({
    title: meeting.title,
    startAt: meeting.startAt,
    location: meeting.location,
    description: meetingDescription(meeting),
  });
  const external = { target: "_blank", rel: "noreferrer" };
  return (
    <div style={{ fontSize: "0.85rem", display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)" }}>Add to calendar:</span>
      {links && (
        <>
          <a href={links.google} {...external}>
            Google
          </a>
          <a href={links.outlook} {...external}>
            Outlook
          </a>
          <a href={links.office365} {...external}>
            Outlook (work/school)
          </a>
          <a href={links.yahoo} {...external}>
            Yahoo
          </a>
        </>
      )}
      <a href={tripMeetingIcsUrl(meeting.id, accessToken)}>Apple / other (.ics)</a>
    </div>
  );
}

export default function PublicTripParticipant() {
  const { shareToken } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("token");
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [signingId, setSigningId] = useState(null);
  const [signingError, setSigningError] = useState("");
  const [submittingSignature, setSubmittingSignature] = useState(false);
  const [uploadingRequirementId, setUploadingRequirementId] = useState(null);
  const [uploadError, setUploadError] = useState("");
  // Nothing saves until Save is clicked (no autosave).
  const [editingPage, setEditingPage] = useState(false);
  const [pageDraftStory, setPageDraftStory] = useState("");
  const [pageDraftPhotoDataUrl, setPageDraftPhotoDataUrl] = useState(null);
  const [pageDraftPhotoContentType, setPageDraftPhotoContentType] = useState(null);
  const [savingPage, setSavingPage] = useState(false);
  const [pageSaveError, setPageSaveError] = useState("");
  const selfService = !!accessToken;

  const reload = React.useCallback(() => {
    const fetcher = selfService
      ? fetchTripParticipantSelfService(accessToken)
      : fetchPublicTripParticipantByToken(shareToken);
    // Returned so handlePhotoChange can wait for the server-confirmed photo before dropping its preview.
    return fetcher.then(setData).catch(() => setNotFound(true));
  }, [shareToken, accessToken, selfService]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleSign(requirementId, { signerName, signerRelationship, signatureImage }) {
    setSubmittingSignature(true);
    setSigningError("");
    try {
      await signTripRequirement(requirementId, {
        token: accessToken,
        signerName,
        signerRelationship,
        signatureImage,
      });
      setSigningId(null);
      reload();
    } catch (err) {
      setSigningError(err.response?.data?.error || "Couldn't record your signature -- please try again.");
    } finally {
      setSubmittingSignature(false);
    }
  }

  // Document-kind counterpart to handleSign: a file instead of a signature.
  async function handleUploadRequirementDocument(requirementId, file) {
    if (!file) return;
    setUploadingRequirementId(requirementId);
    setUploadError("");
    try {
      await uploadTripRequirementDocument(requirementId, { token: accessToken, file });
      await reload();
    } catch (err) {
      setUploadError(err.response?.data?.error || "Couldn't upload that file -- please try again.");
    } finally {
      setUploadingRequirementId(null);
    }
  }

  // Self-service only; no review step, same trust level as other self-reported participant data.
  function startEditingPage() {
    setPageDraftStory(data.story || "");
    setPageDraftPhotoDataUrl(null);
    setPageDraftPhotoContentType(null);
    setPageSaveError("");
    setEditingPage(true);
  }

  function cancelEditingPage() {
    setEditingPage(false);
    setPageSaveError("");
  }

  async function handleDraftPhotoChange(file) {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPageDraftPhotoDataUrl(dataUrl);
    setPageDraftPhotoContentType(file.type);
  }

  async function handleSavePage(e) {
    e.preventDefault();
    setSavingPage(true);
    setPageSaveError("");
    try {
      await updateTripParticipantSelfService({
        token: accessToken,
        story: pageDraftStory,
        ...(pageDraftPhotoDataUrl
          ? { photo: pageDraftPhotoDataUrl, photoContentType: pageDraftPhotoContentType }
          : {}),
      });
      setEditingPage(false);
      await reload();
    } catch (err) {
      setPageSaveError(err.response?.data?.error || "Couldn't save -- please try again.");
    } finally {
      setSavingPage(false);
    }
  }

  if (notFound) {
    return (
      <div>
        <PublicSiteHeader title="Trip" />
        <div className="admin-shell">
          <p>This page couldn't be found.</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="admin-shell">Loading…</div>;

  const goalPercent = data.supportRaisingGoal
    ? Math.round(Math.min(100, (data.raised / data.supportRaisingGoal) * 100))
    : null;

  return (
    <div>
      <meta name="robots" content="noindex" />
      <PublicSiteHeader title={`${data.firstName} ${data.lastName || ""}`} />
      <DemoBanner />
      <div className="admin-shell" style={{ maxWidth: 680 }}>
        {/* Same card in both render modes: one header, one layout to maintain. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "1rem",
            background: "var(--brand-header-color, #2c2a28)",
            borderRadius: 10,
            color: "white",
          }}
        >
          {data.hasPhoto && (
            <img
              src={tripParticipantPhotoUrl(data.id)}
              alt=""
              style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
            />
          )}
          <div>
            <h2 style={{ margin: 0, color: "white" }}>
              {data.firstName} {data.lastName || ""}
            </h2>
            <p style={{ margin: "0.2rem 0 0", color: "#d8d5d0" }}>
              {data.trip.name || data.trip.type} ·{" "}
              {data.trip.startDate ? formatDate(data.trip.startDate) : ""}
              {data.trip.endDate ? ` – ${formatDate(data.trip.endDate)}` : ""}
            </p>
          </div>
        </div>

        {data.trip.description && <p style={{ marginTop: "1rem" }}>{data.trip.description}</p>}

        {data.story && <p>{data.story}</p>}

        <div className="admin-section">
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <span>
              ${data.raised} raised
              {goalPercent != null && (
                <span style={{ color: "var(--brand-color, #2a5d3c)" }}> ({goalPercent}%)</span>
              )}
            </span>
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              {data.supportRaisingGoal ? `of $${data.supportRaisingGoal} goal` : ""}
            </span>
          </div>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "var(--surface-2)",
              overflow: "hidden",
              marginTop: 6,
            }}
          >
            <div
              style={{
                height: "100%",
                width: data.supportRaisingGoal
                  ? `${Math.min(100, (data.raised / data.supportRaisingGoal) * 100)}%`
                  : "0%",
                background: "var(--accent)",
              }}
            />
          </div>
        </div>

        {/* Self-service only; data.shareToken is null when allowPublicSupportRaisingLinks is off or none was issued yet. */}
        {selfService && data.shareToken && (
          <div className="admin-section">
            <h3>Your support-raising page</h3>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Share this link with family and friends:{" "}
              <code>{`${window.location.origin}/trip-support-raising/${data.shareToken}`}</code>{" "}
              <CopyButton
                text={`${window.location.origin}/trip-support-raising/${data.shareToken}`}
                label="Copy your support-raising link"
              />
            </p>
            {!editingPage ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.6rem" }}>
                  {data.hasPhoto && (
                    <img
                      src={tripParticipantPhotoUrl(data.id)}
                      alt=""
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        objectFit: "cover",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <p style={{ margin: 0, color: "var(--muted)" }}>{data.story || "No story set yet."}</p>
                </div>
                <button
                  type="button"
                  className="btn secondary small"
                  style={{ marginTop: "0.6rem" }}
                  onClick={startEditingPage}
                >
                  Edit your story &amp; photo
                </button>
              </>
            ) : (
              <form onSubmit={handleSavePage} style={{ marginTop: "0.6rem" }}>
                <label style={{ display: "block" }}>
                  Your story (shown on your public page)
                  <textarea
                    rows={3}
                    value={pageDraftStory}
                    onChange={(e) => setPageDraftStory(e.target.value)}
                  />
                </label>
                <label style={{ display: "block", marginTop: "0.6rem" }}>
                  Your photo
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.3rem" }}>
                    {(pageDraftPhotoDataUrl || data.hasPhoto) && (
                      <img
                        src={pageDraftPhotoDataUrl || tripParticipantPhotoUrl(data.id)}
                        alt=""
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          objectFit: "cover",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => handleDraftPhotoChange(e.target.files[0] || null)}
                    />
                  </div>
                  {!pageDraftPhotoDataUrl && !data.hasPhoto && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        color: "var(--muted)",
                        marginTop: "0.2rem",
                      }}
                    >
                      No photo on file yet.
                    </span>
                  )}
                </label>
                {pageSaveError && (
                  <p className="form-error" role="alert" style={{ marginTop: "0.6rem" }}>
                    {pageSaveError}
                  </p>
                )}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button type="submit" className="btn small" disabled={savingPage}>
                    {savingPage ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={cancelEditingPage}
                    disabled={savingPage}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Server-side filtered to this participant's own segments, so there is nothing to label. */}
        {selfService && data.trip.flightSegments?.length > 0 && (
          <div className="admin-section">
            <h3>Flight itinerary</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {data.trip.flightSegments.map((seg) => (
                <li
                  key={seg.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "0.6rem 0.8rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {seg.airline} {seg.flightNumber}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    {seg.departureAirport}
                    {seg.departureAt &&
                      ` — ${new Date(seg.departureAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
                    {" → "}
                    {seg.arrivalAirport}
                    {seg.arrivalAt &&
                      ` — ${new Date(seg.arrivalAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selfService && data.meetings?.length > 0 && (
          <div className="admin-section">
            <h3>Meetings</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {data.meetings.map((m) => (
                <li
                  key={m.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "0.6rem 0.8rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {m.title ? `${m.title} — ` : ""}
                    {formatDate(m.startAt)} {m.location ? `— ${m.location}` : ""}
                  </div>
                  <div style={{ fontSize: "0.85rem", display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
                    {m.meetingLink && (
                      <a href={m.meetingLink} target="_blank" rel="noreferrer">
                        Join online
                      </a>
                    )}
                  </div>
                  <AddToCalendar meeting={m} accessToken={accessToken} />
                  {m.agenda && (
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)", whiteSpace: "pre-wrap" }}>
                      {m.agenda}
                    </div>
                  )}
                  <div style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>
                    {m.myRsvp ? (
                      <>
                        You responded: <strong>{RSVP_LABELS[m.myRsvp] || m.myRsvp}</strong>. Changed your
                        mind?{" "}
                      </>
                    ) : (
                      "Will you be there? "
                    )}
                    <a href={tripMeetingRsvpUrl(m.id, "yes", accessToken)}>Yes</a>
                    {" · "}
                    <a href={tripMeetingRsvpUrl(m.id, "no", accessToken)}>No</a>
                    {" · "}
                    <a href={tripMeetingRsvpUrl(m.id, "maybe", accessToken)}>Maybe</a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selfService && data.requirements?.some((r) => !r.fulfilled) && (
          <div className="admin-section">
            <h3>Still needed from you</h3>
            {signingError && (
              <p style={{ color: "var(--danger)" }} role="alert">
                {signingError}
              </p>
            )}
            {uploadError && (
              <p style={{ color: "var(--danger)" }} role="alert">
                {uploadError}
              </p>
            )}
            <ul>
              {data.requirements
                .filter((r) => !r.fulfilled)
                .map((r) => {
                  const overdue = r.dueAt && new Date(r.dueAt) < new Date();
                  return (
                    <li
                      key={r.id}
                      style={{
                        marginBottom: r.kind === "esignature" || r.kind === "document" ? "0.6rem" : 0,
                      }}
                    >
                      {r.label}
                      {r.dueAt && ` — due ${formatDate(r.dueAt)}`}
                      {overdue && <strong style={{ color: "var(--danger)" }}> (overdue)</strong>}
                      {r.kind === "document" && (
                        <div style={{ marginTop: "0.3rem" }}>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            disabled={uploadingRequirementId === r.id}
                            onChange={(e) => handleUploadRequirementDocument(r.id, e.target.files[0] || null)}
                          />
                          {uploadingRequirementId === r.id && (
                            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}> Uploading…</span>
                          )}
                        </div>
                      )}
                      {r.kind === "esignature" && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="btn secondary small"
                            onClick={() => setSigningId(signingId === r.id ? null : r.id)}
                          >
                            {signingId === r.id ? "Cancel" : "Sign now"}
                          </button>
                          {signingId === r.id && (
                            <div style={{ marginTop: "0.5rem" }}>
                              <SignatureCapture
                                documentText={r.bodyText || ""}
                                submitting={submittingSignature}
                                onSubmit={(payload) => handleSign(r.id, payload)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        )}

        {/* Shared files from the admin's "Trip-wide documents" section (AdminTripRequirements.jsx). Labeled
        "Documents for this trip" because "Trip-wide" only means something to an admin. */}
        {selfService && data.tripWideDocuments?.length > 0 && (
          <div className="admin-section">
            <h3>Documents for this trip</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {data.tripWideDocuments.map((doc) => (
                <li key={doc.id} style={{ marginBottom: "0.3rem" }}>
                  {doc.title || doc.fileName}
                  {doc.fileSize != null && (
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                      {" "}
                      ({formatFileSize(doc.fileSize)})
                    </span>
                  )}{" "}
                  <a
                    href={tripDocumentDownloadUrl(doc.id, accessToken)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn secondary small"
                  >
                    View
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selfService && data.contributions?.length > 0 && (
          <div className="admin-section">
            <h3>Donors</h3>
            <ul>
              {data.contributions.map((c, i) => (
                <li key={i}>
                  {c.donorName} — ${c.amount}
                  {c.donorEmail ? ` (${c.donorEmail})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="admin-section">
          <h3>How to give</h3>
          <ol>
            <li>
              Give directly to the church — note "{data.firstName} {data.lastName} —{" "}
              {data.trip.name || data.trip.type}" so it's credited to this trip.
            </li>
            <li>
              Give directly to {data.firstName} — pass along your gift and they'll record it with the church
              office.
            </li>
            {data.giving?.onlineGivingUrl && (
              <li>
                Give online: <a href={data.giving.onlineGivingUrl}>{data.giving.onlineGivingUrl}</a>
                {data.giving.onlineGivingInstructions && <> — {data.giving.onlineGivingInstructions}</>}
              </li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
