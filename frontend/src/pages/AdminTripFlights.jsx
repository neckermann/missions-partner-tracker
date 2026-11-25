import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addTripFlightSegment, updateTripFlightSegment, deleteTripFlightSegment } from "../api/client.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";
import RecordList from "../components/admin/RecordList.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Field from "../components/admin/Field.jsx";

const emptyFlightForm = {
  participantIds: [],
  airline: "",
  flightNumber: "",
  departureAirport: "",
  departureAt: "",
  arrivalAirport: "",
  arrivalAt: "",
};

function FlightFields({ form, setForm, participants }) {
  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  return (
    <div className="form-grid">
      <label style={{ gridColumn: "1 / -1" }}>
        Who (leave empty for whole team)
        <select
          multiple
          style={{ width: "100%", height: "4.5rem" }}
          value={form.participantIds}
          onChange={(e) =>
            set(
              "participantIds",
              Array.from(e.target.selectedOptions).map((o) => o.value)
            )
          }
        >
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Airline
        <input value={form.airline} onChange={(e) => set("airline", e.target.value)} />
      </label>
      <label>
        Flight #
        <input value={form.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} />
      </label>
      <label>
        Departure airport
        <input value={form.departureAirport} onChange={(e) => set("departureAirport", e.target.value)} />
      </label>
      <label>
        Departs
        <input
          type="datetime-local"
          value={form.departureAt}
          onChange={(e) => set("departureAt", e.target.value)}
        />
      </label>
      <label>
        Arrival airport
        <input value={form.arrivalAirport} onChange={(e) => set("arrivalAirport", e.target.value)} />
      </label>
      <label>
        Arrives
        <input
          type="datetime-local"
          value={form.arrivalAt}
          onChange={(e) => set("arrivalAt", e.target.value)}
        />
      </label>
    </div>
  );
}

export default function AdminTripFlights() {
  const { trip, reload, confirmDialog, canWrite } = useOutletContext();
  const [error, setError] = useState("");
  const [segModal, setSegModal] = useState(null); // null | { id: null|segId, form }

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  function openAdd() {
    setSegModal({ id: null, form: emptyFlightForm });
  }

  function openEdit(seg) {
    setSegModal({
      id: seg.id,
      form: {
        participantIds: (seg.participants || []).map((p) => p.id),
        airline: seg.airline || "",
        flightNumber: seg.flightNumber || "",
        departureAirport: seg.departureAirport || "",
        departureAt: seg.departureAt ? seg.departureAt.slice(0, 16) : "",
        arrivalAirport: seg.arrivalAirport || "",
        arrivalAt: seg.arrivalAt ? seg.arrivalAt.slice(0, 16) : "",
      },
    });
  }

  function setSegModalForm(updater) {
    setSegModal((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitSegModal() {
    const patch = {
      participantIds: segModal.form.participantIds,
      airline: segModal.form.airline.trim() || null,
      flightNumber: segModal.form.flightNumber.trim() || null,
      departureAirport: segModal.form.departureAirport.trim() || null,
      departureAt: segModal.form.departureAt || null,
      arrivalAirport: segModal.form.arrivalAirport.trim() || null,
      arrivalAt: segModal.form.arrivalAt || null,
    };
    if (segModal.id == null) await addTripFlightSegment(trip.id, patch);
    else await updateTripFlightSegment(segModal.id, patch);
    reload();
  }

  async function handleDeleteFlightSegment(seg) {
    const confirmed = await confirmDialog({
      title: "Remove this flight segment?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripFlightSegment(seg.id);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't remove this flight segment.");
    }
  }

  const participants = trip.participants || [];

  return (
    <div className="admin-section">
      <h3>Flight itinerary</h3>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        Entered once after group travel is booked. Shown only on each participant's own self-service page,
        never publicly. Add one row per leg — a connection is two rows; select who a segment applies to (e.g.
        just two people on their own routing) — selecting nobody means the whole team.
      </p>
      <RecordList
        bare
        items={trip.flightSegments || []}
        canEdit={canWrite}
        canDelete={canWrite}
        addLabel="+ Add flight segment"
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={handleDeleteFlightSegment}
        emptyMessage="No flight segments yet."
        renderItem={(seg) => (
          <>
            <Field
              label="Who"
              value={
                (seg.participants || []).length === 0
                  ? "Whole team"
                  : seg.participants.map((p) => p.firstName).join(", ")
              }
            />
            <Field
              label="Airline / Flight #"
              value={[seg.airline, seg.flightNumber].filter(Boolean).join(" ")}
              showEmpty
            />
            <Field
              label="Departs"
              value={[
                seg.departureAirport,
                seg.departureAt ? new Date(seg.departureAt).toLocaleString() : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              showEmpty
            />
            <Field
              label="Arrives"
              value={[seg.arrivalAirport, seg.arrivalAt ? new Date(seg.arrivalAt).toLocaleString() : null]
                .filter(Boolean)
                .join(" · ")}
              showEmpty
            />
          </>
        )}
      />

      {segModal && canWrite && (
        <QuickActionModal
          title={segModal.id == null ? "Add Flight Segment" : "Edit Flight Segment"}
          onClose={() => setSegModal(null)}
          onSubmit={submitSegModal}
        >
          <FlightFields form={segModal.form} setForm={setSegModalForm} participants={participants} />
        </QuickActionModal>
      )}
    </div>
  );
}
