import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCareTeam, setCareTeam, fetchCareTeamCandidates } from "../../api/client.js";
import QuickActionModal from "../shared/QuickActionModal.jsx";
import StatusPill from "./StatusPill.jsx";

// A partner's care team (#289): one Lead plus Members, all logins. The same
// panel serves the partner page and the trip page, and is the "assign a care
// team" wizard from both -- pick the lead and the members, save, done.
// Terms are fixed ("Care team", "Lead", "Member", "Guest"), not settings.
//
// Everyone who can see the partner can see the team; only admin/editor
// (`canEdit`) can change it. A guest sees names only (the API leaves emails
// off for them). `showHeading` lets the trip page, which has its own
// heading, drop the card chrome.
export function memberName(m) {
  return [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || "Someone";
}

export default function CareTeamPanel({ partnerId, canEdit, canInviteGuest = false }) {
  const [team, setTeam] = useState(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(
    () =>
      fetchCareTeam(partnerId)
        .then((t) => {
          setTeam(t);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [partnerId]
  );
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="admin-section" id="section-care-team" style={{ scrollMarginTop: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Care team</h3>
        {canEdit && team && (
          <button type="button" className="btn secondary small" onClick={() => setEditing(true)}>
            {team.lead || team.members.length ? "Edit care team" : "+ Assign care team"}
          </button>
        )}
      </div>
      {failed && <p style={{ color: "var(--danger)" }}>Couldn't load the care team.</p>}
      {team && !team.lead && team.members.length === 0 && (
        <p style={{ margin: "0.5rem 0 0", color: "#555" }}>
          Nobody is assigned to keep in touch with this partner yet.
        </p>
      )}
      {team && (team.lead || team.members.length > 0) && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
          {team.lead && (
            <li style={{ padding: "0.25rem 0" }}>
              <strong>{memberName(team.lead)}</strong> <StatusPill label="Lead" color="#2a5d3c" />
              {team.lead.role === "guest" && <span style={{ color: "var(--muted)" }}> · Guest</span>}
            </li>
          )}
          {team.members.map((m) => (
            <li key={m.userId} style={{ padding: "0.25rem 0" }}>
              {memberName(m)}{" "}
              <span style={{ color: "var(--muted)" }}>Member{m.role === "guest" ? " · Guest" : ""}</span>
            </li>
          ))}
          {team && !team.lead && (
            <li style={{ color: "#a6540f", fontSize: "0.85rem", paddingTop: "0.25rem" }}>No lead yet.</li>
          )}
        </ul>
      )}
      {editing && (
        <EditCareTeamModal
          partnerId={partnerId}
          team={team}
          canInviteGuest={canInviteGuest}
          onClose={() => setEditing(false)}
          onSaved={(next) => setTeam(next)}
        />
      )}
    </div>
  );
}

function EditCareTeamModal({ partnerId, team, canInviteGuest, onClose, onSaved }) {
  const [candidates, setCandidates] = useState(null);
  const [leadUserId, setLeadUserId] = useState(team?.lead?.userId || "");
  const [memberIds, setMemberIds] = useState(new Set(team?.members.map((m) => m.userId) || []));

  useEffect(() => {
    fetchCareTeamCandidates()
      .then(setCandidates)
      .catch(() => setCandidates([]));
  }, []);

  async function handleSubmit() {
    const saved = await setCareTeam(partnerId, {
      leadUserId: leadUserId || null,
      memberUserIds: [...memberIds].filter((id) => id !== leadUserId),
    });
    onSaved(saved);
  }

  function toggle(id) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <QuickActionModal
      title="Care team"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitDisabled={!candidates}
    >
      {!candidates ? (
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      ) : (
        <>
          <label>
            Lead
            <select value={leadUserId} onChange={(e) => setLeadUserId(e.target.value)}>
              <option value="">No lead yet</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {memberName(u)} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <fieldset style={{ border: "none", padding: 0, margin: "1rem 0 0" }}>
            <legend style={{ fontWeight: 600 }}>Members</legend>
            <div style={{ maxHeight: "14rem", overflow: "auto" }}>
              {candidates
                .filter((u) => u.id !== leadUserId)
                .map((u) => (
                  <label
                    key={u.id}
                    style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.2rem 0" }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={memberIds.has(u.id)}
                      onChange={() => toggle(u.id)}
                    />
                    {memberName(u)} <span style={{ color: "var(--muted)" }}>{u.email}</span>
                    {u.role === "guest" && <span style={{ color: "var(--muted)" }}>· Guest</span>}
                  </label>
                ))}
            </div>
          </fieldset>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.75rem" }}>
            Everyone on the team is notified the same way. A team member needs a login; someone outside your
            team can be a Guest.
            {canInviteGuest && (
              <>
                {" "}
                <Link to={`/admin/settings/users/new?partnerId=${partnerId}`}>Invite a new guest</Link>
              </>
            )}
          </p>
        </>
      )}
    </QuickActionModal>
  );
}
