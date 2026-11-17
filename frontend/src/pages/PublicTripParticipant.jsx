import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import {
  fetchPublicTripParticipantByToken,
  fetchTripParticipantSelfService,
  signTripRequirement,
  updateTripParticipantSelfService,
  tripParticipantPhotoUrl,
} from "../api/client.js";
import { formatDate } from "../utils/format.js";
import SignatureCapture from "../components/SignatureCapture.jsx";

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
  const [storyDraft, setStoryDraft] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const selfService = !!accessToken;

  const reload = React.useCallback(() => {
    const fetcher = selfService
      ? fetchTripParticipantSelfService(accessToken)
      : fetchPublicTripParticipantByToken(shareToken);
    fetcher.then(setData).catch(() => setNotFound(true));
  }, [shareToken, accessToken, selfService]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleSign(requirementId, { signerName, signatureImage }) {
    setSubmittingSignature(true);
    setSigningError("");
    try {
      await signTripRequirement(requirementId, { token: accessToken, signerName, signatureImage });
      setSigningId(null);
      reload();
    } catch (err) {
      setSigningError(err.response?.data?.error || "Couldn't record your signature -- please try again.");
    } finally {
      setSubmittingSignature(false);
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
    setPhotoUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await updateTripParticipantSelfService({
        token: accessToken,
        photo: dataUrl,
        photoContentType: file.type,
      });
      reload();
    } finally {
      setPhotoUploading(false);
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
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => handlePhotoChange(e.target.files[0] || null)}
              />
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
            <ul>
              {data.meetings.map((m) => (
                <li key={m.id}>
                  {formatDate(m.startAt)} {m.location ? `— ${m.location}` : ""}
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
            <ul>
              {data.requirements
                .filter((r) => !r.fulfilled)
                .map((r) => {
                  const overdue = r.dueAt && new Date(r.dueAt) < new Date();
                  return (
                    <li key={r.id} style={{ marginBottom: r.kind === "esignature" ? "0.6rem" : 0 }}>
                      {r.label}
                      {r.dueAt && ` — due ${formatDate(r.dueAt)}`}
                      {overdue && <strong style={{ color: "#b91c1c" }}> (overdue)</strong>}
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
