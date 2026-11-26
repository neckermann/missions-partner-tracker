import React from "react";

// Chooses the trips a guest login gets, before the account exists (Add User wizard) or when
// promoting one. Value is `[{ tripId, expiresAt }]` (the `tripAccess` shape of POST/PUT
// /api/users); expiresAt optionally overrides "30 days after the trip ends". Existing grants are
// managed in TripAccessList.
export function tripOptionLabel(t) {
  return [t.partner?.displayName, t.name || t.type, t.startDate?.slice(0, 10)].filter(Boolean).join(" — ");
}

export default function TripGrantPicker({ trips, value, onChange }) {
  const chosen = new Set(value.map((g) => g.tripId));
  const remaining = trips.filter((t) => !chosen.has(t.id));
  const tripById = new Map(trips.map((t) => [t.id, t]));

  return (
    <div>
      {value.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem" }}>
          {value.map((g, i) => (
            <li
              key={g.tripId}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "flex-end",
                flexWrap: "wrap",
                marginBottom: "0.5rem",
              }}
            >
              <strong style={{ flex: "1 1 14rem" }}>
                {tripById.has(g.tripId) ? tripOptionLabel(tripById.get(g.tripId)) : "Trip"}
              </strong>
              <label>
                Access until (optional)
                <input
                  type="date"
                  value={g.expiresAt || ""}
                  onChange={(e) =>
                    onChange(value.map((x, j) => (j === i ? { ...x, expiresAt: e.target.value || null } : x)))
                  }
                />
              </label>
              <button
                type="button"
                className="btn secondary small"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        Add a trip
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, { tripId: e.target.value, expiresAt: null }]);
          }}
        >
          <option value="">{remaining.length ? "Choose a trip…" : "No more trips to add"}</option>
          {remaining.map((t) => (
            <option key={t.id} value={t.id}>
              {tripOptionLabel(t)}
            </option>
          ))}
        </select>
      </label>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>
        Unless you pick a date, access ends 30 days after the trip's end date (it never ends on its own for a
        trip with no end date).
      </p>
    </div>
  );
}
