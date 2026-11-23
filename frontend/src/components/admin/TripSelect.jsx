import React from "react";
import { STATUS_LABELS } from "./TripStatusBadge.jsx";
import { formatDate } from "../../utils/format.js";

// A cross-trip picker -- same plain-<select>, grouped shape as
// PartnerSelect.jsx/TripParticipantSelect.jsx, but for choosing which
// *trip* a page should act on, not a partner or a participant. Needed
// by AdminTripContributions.jsx (#272), the first page that isn't
// already scoped to one trip (TripDetailLayout.jsx) or one partner
// (AdminTrips.jsx's own partner filter) and still needs to resolve one.
// Grouped by status, same STATUS_LABELS order TripStatusBadge.jsx uses
// (planning -> accepting applications -> closed -> completed), so an
// active trip -- the common case, a check for a trip still being
// recruited or underway -- isn't buried under a long completed-trip
// history. `trips` is whatever fetchTrips() returned (each including
// its own `partner`/`startDate`/`name`/`type`).
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
