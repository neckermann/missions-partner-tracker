import React from "react";

// Chooses the partners whose care team a new login joins, in the Add User wizard. Value is
// `[{ partnerId }]` (the `careTeam` shape of POST /api/users). All are plain Members; the Lead is
// picked later in the partner's Care team panel. Existing teams are managed in CareTeamPanel.
export default function CareSeatPicker({ partners, value, onChange }) {
  const chosen = new Set(value.map((c) => c.partnerId));
  const remaining = partners.filter((p) => !p.archived && !chosen.has(p.id));
  const byId = new Map(partners.map((p) => [p.id, p]));

  return (
    <div>
      {value.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem" }}>
          {value.map((c) => (
            <li
              key={c.partnerId}
              style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}
            >
              <strong style={{ flex: 1 }}>{byId.get(c.partnerId)?.displayName || "Partner"}</strong>
              <button
                type="button"
                className="btn secondary small"
                onClick={() => onChange(value.filter((x) => x.partnerId !== c.partnerId))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        Add a partner to look after
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, { partnerId: e.target.value }]);
          }}
        >
          <option value="">{remaining.length ? "Choose a partner…" : "No more partners to add"}</option>
          {remaining.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>
        They join each partner's care team as a Member. You can make someone the Lead from that partner's
        page.
      </p>
    </div>
  );
}
