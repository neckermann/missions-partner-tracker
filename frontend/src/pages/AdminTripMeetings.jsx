import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  scheduleTripMeeting,
  updateTripMeeting,
  resendTripMeetingInvite,
  cancelTripMeeting,
  deleteTripMeeting,
} from "../api/client.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

export default function AdminTripMeetings() {
  const { trip, reload, confirmDialog, id } = useOutletContext();
  const [error, setError] = useState("");
  const [expandedMeetingIds, setExpandedMeetingIds] = useState(new Set());
  const [meetingForm, setMeetingForm] = useState({
    startAt: "",
    title: "",
    location: "",
    meetingLink: "",
    agenda: "",
  });

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  function toggleMeetingExpanded(meetingId) {
    setExpandedMeetingIds((prev) => {
      const next = new Set(prev);
      if (next.has(meetingId)) next.delete(meetingId);
      else next.add(meetingId);
      return next;
    });
  }

  async function handleScheduleMeeting(e) {
    e.preventDefault();
    if (!meetingForm.startAt) return;
    try {
      await scheduleTripMeeting(id, {
        startAt: meetingForm.startAt,
        title: meetingForm.title.trim() || null,
        location: meetingForm.location.trim() || null,
        meetingLink: meetingForm.meetingLink.trim() || null,
        agenda: meetingForm.agenda.trim() || null,
      });
      setMeetingForm({ startAt: "", title: "", location: "", meetingLink: "", agenda: "" });
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't schedule this meeting.");
    }
  }

  async function handleUpdateMeeting(meetingId, patch) {
    try {
      await updateTripMeeting(meetingId, patch);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't save that change.");
    }
  }

  async function handleResendMeetingInvite(meetingId) {
    try {
      await resendTripMeetingInvite(meetingId);
      setError("");
    } catch (err) {
      reportError(err, "Couldn't resend the invite.");
    }
  }

  async function handleCancelMeeting(meetingId) {
    const confirmed = await confirmDialog({
      title: "Cancel this meeting?",
      body: (
        <ConfirmMessageBody>
          Everyone on the team who was emailed the original invite will get a cancellation notice.
        </ConfirmMessageBody>
      ),
      confirmLabel: "Cancel meeting",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await cancelTripMeeting(meetingId);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't cancel this meeting.");
    }
  }

  async function handleDeleteMeeting(meetingId) {
    const confirmed = await confirmDialog({
      title: "Delete this meeting?",
      body: (
        <ConfirmMessageBody>
          This cannot be undone. Use this only for a meeting entered by mistake -- use Cancel instead for a
          real meeting that's been called off.
        </ConfirmMessageBody>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripMeeting(meetingId);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't delete this meeting.");
    }
  }

  return (
    <div className="admin-section">
      <h3>Meetings</h3>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <table className="admin-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>When</th>
            <th>Where</th>
            <th>RSVPs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(trip.meetings || []).map((m) => {
            const expanded = expandedMeetingIds.has(m.id);
            const rsvps = m.rsvps || [];
            const tally = { yes: 0, no: 0, maybe: 0 };
            rsvps.forEach((r) => {
              if (tally[r.response] !== undefined) tally[r.response] += 1;
            });
            const participants = trip.participants || [];
            const noResponseCount = participants.length - rsvps.length;
            const whenLabel = m.startAt
              ? new Date(m.startAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
              : "";
            const whereLabel =
              m.location && m.meetingLink
                ? `${m.location} + online`
                : m.location || (m.meetingLink ? "Online" : "—");
            const rsvpSummary = m.cancelledAt
              ? "Cancelled"
              : `${tally.yes} yes · ${tally.no} no · ${tally.maybe} maybe` +
                (noResponseCount > 0 ? ` · ${noResponseCount} no response` : "");
            return (
              <React.Fragment key={m.id}>
                <tr
                  onClick={() => toggleMeetingExpanded(m.id)}
                  style={{
                    cursor: "pointer",
                    ...(m.cancelledAt ? { opacity: 0.6, textDecoration: "line-through" } : undefined),
                  }}
                >
                  <td>{m.title || <span style={{ color: "#888" }}>—</span>}</td>
                  <td>{whenLabel}</td>
                  <td>{whereLabel}</td>
                  <td>{rsvpSummary}</td>
                  <td style={{ textAlign: "right", color: "#888" }}>{expanded ? "▲" : "▼"}</td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={5} style={{ background: "#faf9f7" }}>
                      <div className="form-grid" style={{ marginBottom: "0.75rem" }}>
                        <label>
                          Meeting title
                          <input
                            disabled={!!m.cancelledAt}
                            defaultValue={m.title || ""}
                            placeholder="e.g. Pre-Field Training"
                            onBlur={(e) =>
                              e.target.value !== (m.title || "") &&
                              handleUpdateMeeting(m.id, { title: e.target.value.trim() || null })
                            }
                          />
                        </label>
                        <label>
                          Date/time
                          <input
                            type="datetime-local"
                            disabled={!!m.cancelledAt}
                            defaultValue={m.startAt ? m.startAt.slice(0, 16) : ""}
                            onBlur={(e) =>
                              e.target.value && handleUpdateMeeting(m.id, { startAt: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Location
                          <input
                            disabled={!!m.cancelledAt}
                            defaultValue={m.location || ""}
                            placeholder="In-person location"
                            onBlur={(e) =>
                              e.target.value !== (m.location || "") &&
                              handleUpdateMeeting(m.id, { location: e.target.value.trim() || null })
                            }
                          />
                        </label>
                        <label>
                          Join link
                          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                            <input
                              disabled={!!m.cancelledAt}
                              defaultValue={m.meetingLink || ""}
                              placeholder="https://zoom.us/..."
                              onBlur={(e) =>
                                e.target.value !== (m.meetingLink || "") &&
                                handleUpdateMeeting(m.id, { meetingLink: e.target.value.trim() || null })
                              }
                            />
                            {m.meetingLink && (
                              <a
                                href={m.meetingLink}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}
                              >
                                Open ↗
                              </a>
                            )}
                          </div>
                        </label>
                        <label>
                          Agenda
                          <textarea
                            rows={2}
                            disabled={!!m.cancelledAt}
                            defaultValue={m.agenda || ""}
                            placeholder="What this meeting will cover"
                            onBlur={(e) =>
                              e.target.value !== (m.agenda || "") &&
                              handleUpdateMeeting(m.id, { agenda: e.target.value.trim() || null })
                            }
                          />
                        </label>
                      </div>

                      <div style={{ marginBottom: "0.75rem" }}>
                        <strong style={{ fontSize: "0.85rem" }}>Who's responded</strong>
                        <ul
                          style={{
                            margin: "0.25rem 0 0",
                            padding: 0,
                            listStyle: "none",
                            fontSize: "0.85rem",
                          }}
                        >
                          {participants.map((p) => {
                            const rsvp = rsvps.find((r) => r.participantId === p.id);
                            const label =
                              { yes: "Yes", no: "No", maybe: "Maybe" }[rsvp?.response] || "No response yet";
                            return (
                              <li key={p.id} style={{ padding: "0.15rem 0" }}>
                                {p.firstName} {p.lastName} — {label}
                              </li>
                            );
                          })}
                          {participants.length === 0 && (
                            <li style={{ color: "#888" }}>No participants yet.</li>
                          )}
                        </ul>
                      </div>

                      <div className="table-actions" role="presentation" onClick={(e) => e.stopPropagation()}>
                        {m.cancelledAt ? (
                          <span style={{ fontSize: "0.8rem", color: "#888" }}>Cancelled</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn secondary small"
                              onClick={() => handleResendMeetingInvite(m.id)}
                            >
                              Resend invite
                            </button>{" "}
                            <button
                              type="button"
                              className="btn secondary small"
                              onClick={() => handleCancelMeeting(m.id)}
                            >
                              Cancel
                            </button>{" "}
                            <button
                              type="button"
                              className="btn-remove"
                              onClick={() => handleDeleteMeeting(m.id)}
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {(trip.meetings || []).length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#888" }}>
                No meetings scheduled yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form onSubmit={handleScheduleMeeting} className="form-grid">
        <label>
          Meeting title
          <input
            value={meetingForm.title}
            placeholder="e.g. Pre-Field Training"
            onChange={(e) => setMeetingForm((f) => ({ ...f, title: e.target.value }))}
          />
        </label>
        <label>
          Date/time
          <input
            type="datetime-local"
            value={meetingForm.startAt}
            onChange={(e) => setMeetingForm((f) => ({ ...f, startAt: e.target.value }))}
          />
        </label>
        <label>
          Location
          <input
            value={meetingForm.location}
            onChange={(e) => setMeetingForm((f) => ({ ...f, location: e.target.value }))}
          />
        </label>
        <label>
          Join link (if virtual or hybrid)
          <input
            value={meetingForm.meetingLink}
            placeholder="https://zoom.us/..."
            onChange={(e) => setMeetingForm((f) => ({ ...f, meetingLink: e.target.value }))}
          />
        </label>
        <label>
          Agenda
          <textarea
            rows={2}
            value={meetingForm.agenda}
            placeholder="What this meeting will cover"
            onChange={(e) => setMeetingForm((f) => ({ ...f, agenda: e.target.value }))}
          />
        </label>
        <button type="submit" className="btn secondary small" style={{ alignSelf: "end" }}>
          Schedule meeting
        </button>
      </form>
    </div>
  );
}
