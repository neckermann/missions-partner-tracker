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
import RecordList from "../components/admin/RecordList.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Field from "../components/admin/Field.jsx";
import ManualSendNotice from "../components/shared/ManualSendNotice.jsx";

const emptyMeetingForm = { startAt: "", title: "", location: "", meetingLink: "", agenda: "" };

function MeetingFields({ form, setForm }) {
  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  return (
    <div className="form-grid">
      <label>
        Meeting title
        <input
          value={form.title}
          placeholder="e.g. Pre-Field Training"
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label>
        Date/time
        <input
          type="datetime-local"
          value={form.startAt}
          onChange={(e) => set("startAt", e.target.value)}
          required
        />
      </label>
      <label>
        Location
        <input value={form.location} onChange={(e) => set("location", e.target.value)} />
      </label>
      <label>
        Join link (if virtual or hybrid)
        <input
          value={form.meetingLink}
          placeholder="https://zoom.us/..."
          onChange={(e) => set("meetingLink", e.target.value)}
        />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Agenda
        <textarea
          rows={2}
          value={form.agenda}
          placeholder="What this meeting will cover"
          onChange={(e) => set("agenda", e.target.value)}
        />
      </label>
    </div>
  );
}

// Converted from onBlur-autosave (no explicit boundary, no visible
// confirmation) onto the same click-row-opens-popup RecordList pattern
// used everywhere else -- Schedule/Edit both go through one explicit
// Save, and Resend/Cancel live inside the edit popup since they're
// meeting-specific actions, not generic Add/Edit/Delete.
export default function AdminTripMeetings() {
  const { trip, reload, confirmDialog, id, canWrite } = useOutletContext();
  const [error, setError] = useState("");
  const [modalMeeting, setModalMeeting] = useState(null); // null | { id: null|meetingId, form, cancelledAt }
  const [manualEmailRecipients, setManualEmailRecipients] = useState(null); // [{ name, email, url }] | null

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  function openAdd() {
    setModalMeeting({ id: null, form: emptyMeetingForm, cancelledAt: false });
  }

  function openEdit(m) {
    setModalMeeting({
      id: m.id,
      form: {
        startAt: m.startAt ? m.startAt.slice(0, 16) : "",
        title: m.title || "",
        location: m.location || "",
        meetingLink: m.meetingLink || "",
        agenda: m.agenda || "",
      },
      cancelledAt: !!m.cancelledAt,
    });
  }

  function setModalForm(updater) {
    setModalMeeting((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitModal() {
    const patch = {
      startAt: modalMeeting.form.startAt || null,
      title: modalMeeting.form.title.trim() || null,
      location: modalMeeting.form.location.trim() || null,
      meetingLink: modalMeeting.form.meetingLink.trim() || null,
      agenda: modalMeeting.form.agenda.trim() || null,
    };
    let result;
    if (modalMeeting.id == null) {
      if (!patch.startAt) throw new Error("Choose a date/time");
      result = await scheduleTripMeeting(id, patch);
    } else {
      result = await updateTripMeeting(modalMeeting.id, patch);
    }
    setManualEmailRecipients(result?.manualEmail || null);
    reload();
  }

  async function handleResendMeetingInvite(meetingId) {
    try {
      const result = await resendTripMeetingInvite(meetingId);
      setError("");
      setManualEmailRecipients(result?.manual || null);
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
      const result = await cancelTripMeeting(meetingId);
      setModalMeeting(null);
      reload();
      setError("");
      setManualEmailRecipients(result?.manualEmail || null);
    } catch (err) {
      reportError(err, "Couldn't cancel this meeting.");
    }
  }

  async function handleDeleteMeeting(m) {
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
      await deleteTripMeeting(m.id);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't delete this meeting.");
    }
  }

  const participants = trip.participants || [];

  return (
    <div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {manualEmailRecipients?.length > 0 && <ManualSendNotice recipients={manualEmailRecipients} />}
      <RecordList
        title="Meetings"
        items={trip.meetings || []}
        canEdit={canWrite}
        canDelete={canWrite}
        emptyMessage="No meetings scheduled yet."
        addLabel="Schedule meeting"
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={handleDeleteMeeting}
        renderItem={(m) => {
          const rsvps = m.rsvps || [];
          const tally = { yes: 0, no: 0, maybe: 0 };
          rsvps.forEach((r) => {
            if (tally[r.response] !== undefined) tally[r.response] += 1;
          });
          const noResponseCount = participants.length - rsvps.length;
          const whenLabel = m.startAt
            ? new Date(m.startAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
            : "—";
          const whereLabel =
            m.location && m.meetingLink
              ? `${m.location} + online`
              : m.location || (m.meetingLink ? "Online" : "—");
          const rsvpSummary = m.cancelledAt
            ? "Cancelled"
            : `${tally.yes} yes · ${tally.no} no · ${tally.maybe} maybe` +
              (noResponseCount > 0 ? ` · ${noResponseCount} no response` : "");
          return (
            <>
              <Field label="Title" value={m.title} showEmpty />
              <Field label="When" value={whenLabel} showEmpty />
              <Field label="Where" value={whereLabel} showEmpty />
              <Field label="RSVPs" value={rsvpSummary} showEmpty />
            </>
          );
        }}
      />

      {modalMeeting &&
        (canWrite ? (
          <QuickActionModal
            title={modalMeeting.id == null ? "Schedule meeting" : "Edit meeting"}
            onClose={() => setModalMeeting(null)}
            onSubmit={submitModal}
            submitLabel={modalMeeting.id == null ? "Schedule meeting" : "Save"}
          >
            <MeetingFields form={modalMeeting.form} setForm={setModalForm} />
            {modalMeeting.id != null && (
              <div className="table-actions" style={{ marginTop: "0.75rem" }}>
                {modalMeeting.cancelledAt ? (
                  <span style={{ fontSize: "0.8rem", color: "#888" }}>Cancelled</span>
                ) : (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => handleResendMeetingInvite(modalMeeting.id)}
                  >
                    Resend invite
                  </button>
                )}
                {!modalMeeting.cancelledAt && (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => handleCancelMeeting(modalMeeting.id)}
                  >
                    Cancel meeting
                  </button>
                )}
              </div>
            )}
            {participants.length > 0 && (
              <div style={{ marginTop: "0.75rem" }}>
                <strong style={{ fontSize: "0.85rem" }}>Who's responded</strong>
                <ul style={{ margin: "0.25rem 0 0", padding: 0, listStyle: "none", fontSize: "0.85rem" }}>
                  {participants.map((p) => {
                    const rsvp = (trip.meetings?.find((m) => m.id === modalMeeting.id)?.rsvps || []).find(
                      (r) => r.participantId === p.id
                    );
                    const label =
                      { yes: "Yes", no: "No", maybe: "Maybe" }[rsvp?.response] || "No response yet";
                    return (
                      <li key={p.id} style={{ padding: "0.15rem 0" }}>
                        {p.firstName} {p.lastName} — {label}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </QuickActionModal>
        ) : null)}
    </div>
  );
}
