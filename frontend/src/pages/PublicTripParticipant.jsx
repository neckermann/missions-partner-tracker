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

// New (#252) -- serves both the plain public support-raising view (by
// shareToken, route /trip-support-raising/:shareToken) and the participant's
// own self-service view (by signed access token, route /my-trip?token=...)
// -- one page, two render modes. The public view never shows
// flightSegments or donor contact info; the self-service view shows both.
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
  const [storyDraft, setStoryDraft] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  // Object URL for a just-picked file, shown immediately next to the file
  // input (not the header above) -- the only existing photo indicator was
  // that header image, scrolled out of view from the input itself, so
  // there was no way to tell a photo was already on file (or that a new
  // pick actually worked) without scrolling up.
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const selfService = !!accessToken;

  const reload = React.useCallback(() => {
    const fetcher = selfService
      ? fetchTripParticipantSelfService(accessToken)
      : fetchPublicTripParticipantByToken(shareToken);
    // Returned (not fire-and-forget) so handlePhotoChange can wait for the
    // server-confirmed photo before dropping its own object-URL preview --
    // otherwise there'd be a flash back to "no photo" in between.
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

  // Document-kind requirement counterpart to handleSign below -- same
  // "fulfilled by the server, reload to pick up the new state" shape,
  // just a file instead of a signature.
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

  // Self-service only -- no review step, same trust level as the
  // address/emergency-contact/application answers a participant already
  // self-reports elsewhere with no review.
  async function handleSaveStory() {
    if (storyDraft === null) return;
    await updateTripParticipantSelfService({ token: accessToken, story: storyDraft });
    setStoryDraft(null);
    reload();
  }

  async function handlePhotoChange(file) {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(previewUrl);
    setPhotoUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await updateTripParticipantSelfService({
        token: accessToken,
        photo: dataUrl,
        photoContentType: file.type,
      });
      await reload();
    } finally {
      setPhotoUploading(false);
      // Drop the local preview once `data.hasPhoto`/`tripParticipantPhotoUrl`
      // has the real, server-confirmed image to show instead -- revoking
      // before that point (e.g. on a failed upload) would just blank the
      // image rather than leave a stale one on screen.
      setPhotoPreviewUrl(null);
      URL.revokeObjectURL(previewUrl);
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
        {/* Same card in both render modes -- no evidence self-service
        should look different from what a donor sees, and one shared
        header avoids a second layout to maintain. */}
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
            <span style={{ color: "#6b6f76", fontWeight: 400 }}>
              {data.supportRaisingGoal ? `of $${data.supportRaisingGoal} goal` : ""}
            </span>
          </div>
          <div
            style={{ height: 10, borderRadius: 999, background: "#ece9e4", overflow: "hidden", marginTop: 6 }}
          >
            <div
              style={{
                height: "100%",
                width: data.supportRaisingGoal
                  ? `${Math.min(100, (data.raised / data.supportRaisingGoal) * 100)}%`
                  : "0%",
                background: "#2a5d3c",
              }}
            />
          </div>
        </div>

        {/* Self-service only; gated on data.shareToken existing (null when
        allowPublicSupportRaisingLinks is off, or this participant hasn't
        been given one yet -- same "doesn't exist" treatment as the rest
        of this feature's own toggles, not a disabled state). */}
        {selfService && data.shareToken && (
          <div className="admin-section">
            <h3>Your support-raising page</h3>
            <p style={{ color: "#888", fontSize: "0.85rem" }}>
              Share this link with family and friends:{" "}
              <code>{`${window.location.origin}/trip-support-raising/${data.shareToken}`}</code>
            </p>
            <label style={{ display: "block", marginTop: "0.6rem" }}>
              Your story (shown on your public page)
              <textarea
                rows={3}
                defaultValue={data.story || ""}
                onChange={(e) => setStoryDraft(e.target.value)}
                onBlur={handleSaveStory}
              />
            </label>
            <label style={{ display: "block", marginTop: "0.6rem" }}>
              Your photo
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.3rem" }}>
                {(photoPreviewUrl || data.hasPhoto) && (
                  <img
                    src={photoPreviewUrl || tripParticipantPhotoUrl(data.id)}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                  />
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handlePhotoChange(e.target.files[0] || null)}
                />
              </div>
              {!photoPreviewUrl && !data.hasPhoto && (
                <span style={{ display: "block", fontSize: "0.8rem", color: "#888", marginTop: "0.2rem" }}>
                  No photo on file yet.
                </span>
              )}
              {photoUploading && <span style={{ fontSize: "0.8rem", color: "#888" }}> Uploading…</span>}
            </label>
          </div>
        )}

        {/* Replaces the former flightDetails free-text paragraph (#252
        follow-on, per the approved mockup) -- a clean itinerary instead
        of a blob of text. Server-side filtered to this participant's own
        segments (issue #265) -- every segment shown here already applies
        to them, so there's nothing left to label. */}
        {selfService && data.trip.flightSegments?.length > 0 && (
          <div className="admin-section">
            <h3>Flight itinerary</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {data.trip.flightSegments.map((seg) => (
                <li
                  key={seg.id}
                  style={{
                    border: "1px solid #e1dfdb",
                    borderRadius: 6,
                    padding: "0.6rem 0.8rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {seg.airline} {seg.flightNumber}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#555" }}>
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
                    border: "1px solid #e1dfdb",
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
                    <a href={tripMeetingIcsUrl(m.id, accessToken)}>Add to calendar</a>
                  </div>
                  {m.agenda && (
                    <div style={{ fontSize: "0.85rem", color: "#555", whiteSpace: "pre-wrap" }}>{m.agenda}</div>
                  )}
                  <div style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>
                    {m.myRsvp ? (
                      <>
                        You responded: <strong>{RSVP_LABELS[m.myRsvp] || m.myRsvp}</strong>. Changed your mind?{" "}
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
              <p style={{ color: "#b91c1c" }} role="alert">
                {signingError}
              </p>
            )}
            {uploadError && (
              <p style={{ color: "#b91c1c" }} role="alert">
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
                      style={{ marginBottom: r.kind === "esignature" || r.kind === "document" ? "0.6rem" : 0 }}
                    >
                      {r.label}
                      {r.dueAt && ` — due ${formatDate(r.dueAt)}`}
                      {overdue && <strong style={{ color: "#b91c1c" }}> (overdue)</strong>}
                      {r.kind === "document" && (
                        <div style={{ marginTop: "0.3rem" }}>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            disabled={uploadingRequirementId === r.id}
                            onChange={(e) =>
                              handleUploadRequirementDocument(r.id, e.target.files[0] || null)
                            }
                          />
                          {uploadingRequirementId === r.id && (
                            <span style={{ fontSize: "0.8rem", color: "#888" }}> Uploading…</span>
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

        {/* Shared files from the admin's own "Trip-wide documents" section
        (AdminTripDetail.jsx) -- an itinerary, packing list, etc. Previously
        fetched by this page's own data route but never exposed in the
        response or rendered anywhere, so no participant could ever see one
        despite the admin page's own copy calling them "shared with the
        whole team." */}
        {selfService && data.tripWideDocuments?.length > 0 && (
          <div className="admin-section">
            <h3>Trip-wide documents</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {data.tripWideDocuments.map((doc) => (
                <li key={doc.id} style={{ marginBottom: "0.3rem" }}>
                  {doc.title || doc.fileName}
                  {doc.fileSize != null && (
                    <span style={{ color: "#888", fontSize: "0.8rem" }}> ({formatFileSize(doc.fileSize)})</span>
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
