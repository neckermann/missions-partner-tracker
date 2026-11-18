import React from "react";

// A trip-participant picker, grouped by trip -- same shape as
// PartnerSelect.jsx, but for assigning something (an unmatched inbound
// email) to a specific TripParticipant instead of a Partner. `trips` is
// whatever fetchTrips() returned (each trip including its own
// `participants` array already).
export default function TripParticipantSelect({ trips, value, onChange, required, ...rest }) {
  const withParticipants = trips.filter((t) => (t.participants || []).length > 0);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required={required} {...rest}>
      <option value="">Select one...</option>
      {withParticipants.map((t) => (
        <optgroup key={t.id} label={t.name || t.type || "Untitled trip"}>
          {t.participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
