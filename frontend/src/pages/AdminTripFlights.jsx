import React, { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addTripFlightSegment, updateTripFlightSegment, deleteTripFlightSegment } from "../api/client.js";
import ConfirmMessageBody from "../components/ConfirmMessageBody.jsx";
import { mapServerErrorMessage } from "../utils/friendlyError.js";

// Flight Segments already existed as a real feature (TripFlightSegment
// model + routes) before this phase -- the plan's "zero mockup/issue
// precedent, needs new design" note was stale. This is a split +
// safety-fix pass (visible errors instead of silent onBlur failures),
// not new design.
export default function AdminTripFlights() {
  const { trip, reload, confirmDialog } = useOutletContext();
  const [error, setError] = useState("");
  const [newFlightSegment, setNewFlightSegment] = useState({
    participantIds: [],
    airline: "",
    flightNumber: "",
    departureAirport: "",
    departureAt: "",
    arrivalAirport: "",
    arrivalAt: "",
  });

  function reportError(err, fallback) {
    setError(mapServerErrorMessage(err?.response?.data?.error) || fallback);
  }

  async function handleAddFlightSegment(e) {
    e.preventDefault();
    try {
      await addTripFlightSegment(trip.id, {
        participantIds: newFlightSegment.participantIds,
        airline: newFlightSegment.airline.trim() || null,
        flightNumber: newFlightSegment.flightNumber.trim() || null,
        departureAirport: newFlightSegment.departureAirport.trim() || null,
        departureAt: newFlightSegment.departureAt || null,
        arrivalAirport: newFlightSegment.arrivalAirport.trim() || null,
        arrivalAt: newFlightSegment.arrivalAt || null,
      });
      setNewFlightSegment({
        participantIds: [],
        airline: "",
        flightNumber: "",
        departureAirport: "",
        departureAt: "",
        arrivalAirport: "",
        arrivalAt: "",
      });
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't add this flight segment.");
    }
  }

  async function handleUpdateFlightSegment(segmentId, patch) {
    try {
      await updateTripFlightSegment(segmentId, patch);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't save that change.");
    }
  }

  async function handleDeleteFlightSegment(segmentId) {
    const confirmed = await confirmDialog({
      title: "Remove this flight segment?",
      body: <ConfirmMessageBody>This cannot be undone.</ConfirmMessageBody>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteTripFlightSegment(segmentId);
      reload();
      setError("");
    } catch (err) {
      reportError(err, "Couldn't remove this flight segment.");
    }
  }

  return (
    <div className="admin-section">
      <h3>Flight itinerary</h3>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p style={{ color: "#888", fontSize: "0.85rem" }}>
        Entered once after group travel is booked. Shown only on each participant's own self-service page,
        never publicly. Add one row per leg — a connection is two rows; select who a segment applies to (e.g.
        just two people on their own routing) — selecting nobody means the whole team.
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Who</th>
            <th>Airline / Flight #</th>
            <th>Departs</th>
            <th>Arrives</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(trip.flightSegments || []).map((seg) => (
            <tr key={seg.id}>
              <td>
                <select
                  multiple
                  style={{ width: "9rem", height: "4.5rem" }}
                  value={(seg.participants || []).map((p) => p.id)}
                  onChange={(e) =>
                    handleUpdateFlightSegment(seg.id, {
                      participantIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                    })
                  }
                >
                  {(trip.participants || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: "0.7rem", color: "#888" }}>
                  {(seg.participants || []).length === 0
                    ? "Whole team"
                    : seg.participants.map((p) => p.firstName).join(", ")}
                </div>
              </td>
              <td>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  <input
                    style={{ width: "6rem" }}
                    defaultValue={seg.airline || ""}
                    placeholder="Airline"
                    onBlur={(e) =>
                      e.target.value !== (seg.airline || "") &&
                      handleUpdateFlightSegment(seg.id, { airline: e.target.value.trim() || null })
                    }
                  />
                  <input
                    style={{ width: "5rem" }}
                    defaultValue={seg.flightNumber || ""}
                    placeholder="Flight #"
                    onBlur={(e) =>
                      e.target.value !== (seg.flightNumber || "") &&
                      handleUpdateFlightSegment(seg.id, { flightNumber: e.target.value.trim() || null })
                    }
                  />
                </div>
              </td>
              <td>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  <input
                    style={{ width: "4.5rem" }}
                    defaultValue={seg.departureAirport || ""}
                    placeholder="Airport"
                    onBlur={(e) =>
                      e.target.value !== (seg.departureAirport || "") &&
                      handleUpdateFlightSegment(seg.id, { departureAirport: e.target.value.trim() || null })
                    }
                  />
                  <input
                    type="datetime-local"
                    style={{ width: "11rem" }}
                    defaultValue={seg.departureAt ? seg.departureAt.slice(0, 16) : ""}
                    onBlur={(e) => handleUpdateFlightSegment(seg.id, { departureAt: e.target.value || null })}
                  />
                </div>
              </td>
              <td>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  <input
                    style={{ width: "4.5rem" }}
                    defaultValue={seg.arrivalAirport || ""}
                    placeholder="Airport"
                    onBlur={(e) =>
                      e.target.value !== (seg.arrivalAirport || "") &&
                      handleUpdateFlightSegment(seg.id, { arrivalAirport: e.target.value.trim() || null })
                    }
                  />
                  <input
                    type="datetime-local"
                    style={{ width: "11rem" }}
                    defaultValue={seg.arrivalAt ? seg.arrivalAt.slice(0, 16) : ""}
                    onBlur={(e) => handleUpdateFlightSegment(seg.id, { arrivalAt: e.target.value || null })}
                  />
                </div>
              </td>
              <td className="table-actions">
                <button type="button" className="btn-remove" onClick={() => handleDeleteFlightSegment(seg.id)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {(trip.flightSegments || []).length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#888" }}>
                No flight segments yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        onSubmit={handleAddFlightSegment}
        style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}
      >
        <select
          multiple
          style={{ width: "9rem", height: "4.5rem" }}
          value={newFlightSegment.participantIds}
          onChange={(e) =>
            setNewFlightSegment((f) => ({
              ...f,
              participantIds: Array.from(e.target.selectedOptions).map((o) => o.value),
            }))
          }
        >
          {(trip.participants || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
        <input
          style={{ width: "6rem" }}
          value={newFlightSegment.airline}
          onChange={(e) => setNewFlightSegment((f) => ({ ...f, airline: e.target.value }))}
          placeholder="Airline"
        />
        <input
          style={{ width: "5rem" }}
          value={newFlightSegment.flightNumber}
          onChange={(e) => setNewFlightSegment((f) => ({ ...f, flightNumber: e.target.value }))}
          placeholder="Flight #"
        />
        <input
          style={{ width: "4.5rem" }}
          value={newFlightSegment.departureAirport}
          onChange={(e) => setNewFlightSegment((f) => ({ ...f, departureAirport: e.target.value }))}
          placeholder="From"
        />
        <input
          type="datetime-local"
          style={{ width: "11rem" }}
          value={newFlightSegment.departureAt}
          onChange={(e) => setNewFlightSegment((f) => ({ ...f, departureAt: e.target.value }))}
        />
        <input
          style={{ width: "4.5rem" }}
          value={newFlightSegment.arrivalAirport}
          onChange={(e) => setNewFlightSegment((f) => ({ ...f, arrivalAirport: e.target.value }))}
          placeholder="To"
        />
        <input
          type="datetime-local"
          style={{ width: "11rem" }}
          value={newFlightSegment.arrivalAt}
          onChange={(e) => setNewFlightSegment((f) => ({ ...f, arrivalAt: e.target.value }))}
        />
        <button type="submit" className="btn secondary small">
          + Add flight segment
        </button>
      </form>
    </div>
  );
}
