import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";
import DemoBanner from "../components/DemoBanner.jsx";
import { fetchPublicTripParticipantByToken, fetchTripParticipantSelfService } from "../api/client.js";
import { formatDate } from "../utils/format.js";

// New (#252) -- serves both the plain public support-raising view (by
// shareToken, route /trip-support-raising/:shareToken) and the participant's
// own self-service view (by signed access token, route /my-trip?token=...)
// -- one page, two render modes. The public view never shows
// flightDetails or donor contact info; the self-service view shows both.
export default function PublicTripParticipant() {
  const { shareToken } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("token");
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const selfService = !!accessToken;

  useEffect(() => {
    const fetcher = selfService
      ? fetchTripParticipantSelfService(accessToken)
      : fetchPublicTripParticipantByToken(shareToken);
    fetcher.then(setData).catch(() => setNotFound(true));
  }, [shareToken, accessToken, selfService]);

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

  return (
    <div>
      <meta name="robots" content="noindex" />
      <PublicSiteHeader title={`${data.firstName} ${data.lastName || ""}`} />
      <DemoBanner />
      <div className="admin-shell" style={{ maxWidth: 680 }}>
        <p style={{ color: "#6b6f76" }}>
          {data.trip.name || data.trip.type} · {data.trip.startDate ? formatDate(data.trip.startDate) : ""}
          {data.trip.endDate ? ` – ${formatDate(data.trip.endDate)}` : ""}
        </p>

        {data.story && <p>{data.story}</p>}

        <div className="admin-section">
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <span>${data.raised} raised</span>
            <span style={{ color: "#6b6f76", fontWeight: 400 }}>
              {data.supportRaisingGoal ? `of $${data.supportRaisingGoal} goal` : ""}
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: "#ece9e4", overflow: "hidden", marginTop: 6 }}>
            <div
              style={{
                height: "100%",
                width: data.supportRaisingGoal ? `${Math.min(100, (data.raised / data.supportRaisingGoal) * 100)}%` : "0%",
                background: "#2a5d3c",
              }}
            />
          </div>
        </div>

        {selfService && data.trip.flightDetails && (
          <div className="admin-section">
            <h3>Flight details</h3>
            <p>{data.trip.flightDetails}</p>
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

        {selfService && data.missingDocumentRequirements?.length > 0 && (
          <div className="admin-section">
            <h3>Still needed from you</h3>
            <ul>
              {data.missingDocumentRequirements.map((label) => (
                <li key={label}>{label}</li>
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
            <li>Give directly to the church — note "{data.firstName} {data.lastName} — {data.trip.name}" so it's credited to this trip.</li>
            <li>Give directly to {data.firstName} — pass along your gift and they'll record it with the church office.</li>
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
