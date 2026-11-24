import React, { useState } from "react";
import { formatUtcDate } from "../../utils/format.js";

// One row per trip grant for a guest login (#356), with the controls an
// admin needs: extend, end now, go back to the automatic date, or remove.
// Presentational only -- the caller owns the API calls and passes the
// handlers, so the same list serves the Users page (grants of one guest)
// and a trip's own page (guests of one trip).
//
// `grants` is the API shape: { tripId, trip: { name, type, partner },
// expiresAt (override or null), effectiveExpiresAt, expiresIsOverride,
// active }. `labelFor(grant)` decides the row's headline, since the Users
// page labels a row by trip and a trip's page labels it by guest.
export function describeExpiry(grant) {
  if (!grant.active) {
    return `Ended ${formatUtcDate(grant.effectiveExpiresAt)}`;
  }
  if (!grant.effectiveExpiresAt) return "No end date set on the trip, so no expiry";
  const when = formatUtcDate(grant.effectiveExpiresAt);
  return grant.expiresIsOverride
    ? `Access until ${when} (set by an admin)`
    : `Access until ${when} (30 days after the trip ends)`;
}

export default function TripAccessList({
  grants,
  labelFor,
  onExtend,
  onEndNow,
  onResetDate,
  onRemove,
  busy,
}) {
  const [extending, setExtending] = useState(null); // tripId whose date picker is open
  const [date, setDate] = useState("");

  if (grants.length === 0) {
    return <p style={{ color: "var(--muted)" }}>No trips yet.</p>;
  }

  return (
    <ul className="trip-access-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {grants.map((g) => (
        <li
          key={g.id || g.tripId}
          style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border, #e5e5e5)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
            <div>
              <strong>{labelFor(g)}</strong>
              <div style={{ fontSize: "0.85rem", color: g.active ? "var(--muted)" : "var(--danger)" }}>
                {describeExpiry(g)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn secondary small"
                disabled={busy}
                onClick={() => {
                  setExtending(extending === g.tripId ? null : g.tripId);
                  setDate("");
                }}
              >
                {g.active ? "Extend…" : "Restore…"}
              </button>
              {g.active && (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={busy}
                  onClick={() => onEndNow(g)}
                >
                  End now
                </button>
              )}
              {g.expiresIsOverride && (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={busy}
                  onClick={() => onResetDate(g)}
                >
                  Use automatic date
                </button>
              )}
              <button type="button" className="btn danger small" disabled={busy} onClick={() => onRemove(g)}>
                Remove
              </button>
            </div>
          </div>
          {extending === g.tripId && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginTop: "0.5rem" }}>
              <label>
                Keep access until
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn small"
                disabled={busy || !date}
                onClick={async () => {
                  await onExtend(g, date);
                  setExtending(null);
                }}
              >
                Save
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
