import React from "react";
import { STATUS_LABELS } from "./TripStatusBadge.jsx";
import { formatDate } from "../../utils/format.js";

// A cross-trip picker (plain grouped <select>, like PartnerSelect.jsx) for pages not already scoped
// to one trip or partner. Grouped by status in TripStatusBadge's STATUS_LABELS order so active trips
// aren't buried under completed history. `trips` is whatever fetchTrips() returned.
function tripLabel(trip) {
  const who = trip.partner?.displayName || "No partner linked";
  const what = trip.name || trip.type || "Trip";
  const when = trip.startDate ? ` (${formatDate(trip.startDate)})` : "";
  return `${who} — ${what}${when}`;
}

export default function TripSelect({ trips, value, onChange, required, ...rest }) {
  const groups = Object.entries(STATUS_LABELS)
    .map(([status, label]) => ({ status, label, items: trips.filter((t) => t.status === status) }))
    .filter((g) => g.items.length > 0);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required={required} {...rest}>
      <option value="">Select a trip...</option>
      {groups.map((g) => (
        <optgroup key={g.status} label={g.label}>
          {g.items.map((t) => (
            <option key={t.id} value={t.id}>
              {tripLabel(t)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
