import React from "react";
import { useOutletContext } from "react-router-dom";
import { updateTrip } from "../api/client.js";
import EditableSection from "../components/admin/EditableSection.jsx";

// The former "Trip setup" section of AdminTripDetail.jsx, now the
// landing page for a trip (/admin/trips/:id index) and the first real
// EditableSection use in this file -- retires its own slice of the
// 22 onBlur-autosave sites the plan named.
export default function AdminTripOverview() {
  const { trip, setTrip, enableTripBudgeting, canWrite } = useOutletContext();

  const budgetTotal = (trip.budgetLines || []).reduce((sum, b) => sum + b.estimatedAmount, 0);

  async function saveSetup(fields) {
    const updated = await updateTrip(trip.id, fields);
    setTrip((t) => ({ ...t, ...updated }));
  }

  return (
    <EditableSection
      title="Trip setup"
      canEdit={canWrite}
      value={{
        name: trip.name || "",
        status: trip.status,
        startDate: trip.startDate?.slice(0, 10) || "",
        endDate: trip.endDate?.slice(0, 10) || "",
        teamSizeMin: trip.teamSizeMin ?? "",
        teamSizeMax: trip.teamSizeMax ?? "",
        supportRaisingGoal: trip.supportRaisingGoal ?? "",
        description: trip.description || "",
        isPublic: !!trip.isPublic,
      }}
      onSave={(draft) =>
        saveSetup({
          name: draft.name,
          status: draft.status,
          startDate: draft.startDate || null,
          endDate: draft.endDate || null,
          teamSizeMin: draft.teamSizeMin === "" ? null : Number(draft.teamSizeMin),
          teamSizeMax: draft.teamSizeMax === "" ? null : Number(draft.teamSizeMax),
          supportRaisingGoal: draft.supportRaisingGoal === "" ? null : Number(draft.supportRaisingGoal),
          description: draft.description,
          isPublic: draft.isPublic,
        })
      }
      view={(v) => (
        <div>
          <div className="form-grid">
            <Field label="Trip name" value={v.name || "—"} />
            <Field label="Status" value={STATUS_LABELS[v.status] || v.status} />
            <Field label="Start Date" value={v.startDate || "—"} />
            <Field label="End Date" value={v.endDate || "—"} />
            <Field
              label="Team size"
              value={
                v.teamSizeMin || v.teamSizeMax ? `${v.teamSizeMin || "?"} – ${v.teamSizeMax || "?"}` : "—"
              }
            />
            <Field
              label="Support-raising goal"
              value={v.supportRaisingGoal ? `$${v.supportRaisingGoal}/person` : "—"}
            />
          </div>
          <Field label="Description" value={v.description || "—"} />
          <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            {v.isPublic ? "Visible on public discovery page" : "Not on public discovery page"}
          </p>
          {trip.partner?.isRestricted && (
            <div
              style={{
                background: "#fbeee0",
                border: "1px solid #e3b183",
                borderRadius: 8,
                padding: "0.6rem 0.9rem",
                fontSize: "0.8rem",
                color: "#7a3e0c",
                marginTop: "0.5rem",
              }}
            >
              <strong>This trip is linked to a restricted partner.</strong> The name and description above may
              still appear on a masked public link. Avoid naming the actual location here.
            </div>
          )}
        </div>
      )}
      edit={(draft, set) => (
        <div>
          <div className="form-grid">
            <label>
              Trip name
              <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(e) => set("status", e.target.value)}>
                <option value="planning">Planning</option>
                <option value="accepting_applications">Accepting applications</option>
                <option value="closed">Closed</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label>
              Start Date
              <input type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </label>
            <label>
              End Date
              <input type="date" value={draft.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </label>
            <label>
              Team size min / max
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="number"
                  value={draft.teamSizeMin}
                  onChange={(e) => set("teamSizeMin", e.target.value)}
                />
                <input
                  type="number"
                  value={draft.teamSizeMax}
                  onChange={(e) => set("teamSizeMax", e.target.value)}
                />
              </div>
            </label>
            <label>
              Support-raising goal (per person, $)
              <input
                type="number"
                value={draft.supportRaisingGoal}
                onChange={(e) => set("supportRaisingGoal", e.target.value)}
              />
              {enableTripBudgeting && budgetTotal > 0 && (draft.teamSizeMax || draft.teamSizeMin) && (
                <span style={{ display: "block", color: "#888", fontSize: "0.75rem", marginTop: "0.3rem" }}>
                  Suggested: ~${Math.ceil(budgetTotal / Number(draft.teamSizeMax || draft.teamSizeMin))}
                  /person, based on ${budgetTotal} budgeted ÷ a {draft.teamSizeMax || draft.teamSizeMin}
                  -person team.
                </span>
              )}
            </label>
          </div>
          <label style={{ marginTop: "0.75rem", display: "block" }}>
            Description
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <div className="admin-checkbox-row" style={{ marginTop: "0.75rem" }}>
            <label>
              <input
                type="checkbox"
                checked={draft.isPublic}
                onChange={(e) => set("isPublic", e.target.checked)}
              />
              Visible on public discovery page
            </label>
          </div>
        </div>
      )}
    />
  );
}

const STATUS_LABELS = {
  planning: "Planning",
  accepting_applications: "Accepting applications",
  closed: "Closed",
  completed: "Completed",
};

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "#888", fontWeight: 600 }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}
