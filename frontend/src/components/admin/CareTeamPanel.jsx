import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCareTeam,
  setCareTeam,
  fetchCareTeamCandidates,
  fetchDefaultCareLead,
} from "../../api/client.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import QuickActionModal from "../shared/QuickActionModal.jsx";
import { onClickUnlessSelecting } from "../../utils/clickableRow.js";
import StatusPill from "./StatusPill.jsx";

// A partner's care team: one Lead plus Members, all logins. Serves both the partner page and the
// trip page, and is the "assign a care team" wizard from both. Terms are fixed, not settings.
// Everyone who can see the partner sees the team; only admin/editor (`canEdit`) can change it. A
// guest sees names only (the API omits emails). `showHeading` lets the trip page drop the card chrome.
export function memberName(m) {
  return [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || "Someone";
}

export default function CareTeamPanel({ partnerId, canEdit, canInviteGuest = false, compact = false }) {
  const [team, setTeam] = useState(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  // With nobody assigned, key-date reminders go to the default lead: tell staff (the endpoint is
  // admin/editor only, so it is skipped for everyone else).
  const { enabledFeatures } = useSettings();
  const [defaultLead, setDefaultLead] = useState(null);
  const teamIsEmpty = !!team && !team.lead && team.members.length === 0;
  useEffect(() => {
    if (!canEdit || !enabledFeatures?.keyDates || !teamIsEmpty) return;
    fetchDefaultCareLead()
      .then(setDefaultLead)
      .catch(() => setDefaultLead(null));
  }, [canEdit, enabledFeatures?.keyDates, teamIsEmpty]);

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

  if (compact) {
    // One line on the contact card: who is on the team, with Edit or Assign beside it.
    const people = team
      ? [
          team.lead && { id: team.lead.userId, name: memberName(team.lead), lead: true },
          ...team.members.map((m) => ({ id: m.userId, name: memberName(m), lead: false })),
        ].filter(Boolean)
      : [];
    return (
      <div id="section-care-team" style={{ scrollMarginTop: "1rem" }}>
        {/* The whole line opens the editor; the "Care team:" label is the keyboard way in. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          className={canEdit && team ? "admin-section-clickable" : undefined}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}
          onClick={canEdit && team ? onClickUnlessSelecting(() => setEditing(true)) : undefined}
        >
          <div>
            {canEdit && team ? (
              <button
                type="button"
                className="summary-item-link"
                aria-label={people.length ? "Edit team" : "+ Assign team"}
                style={{ color: "var(--muted)", textDecoration: "none" }}
                onClick={() => setEditing(true)}
              >
                Care team:{" "}
              </button>
            ) : (
              <span style={{ color: "var(--muted)" }}>Care team: </span>
            )}
            {failed && <span style={{ color: "var(--danger)" }}>couldn't load</span>}
            {team && people.length === 0 && (
              <span style={{ color: "var(--muted)" }}>nobody assigned yet</span>
            )}
            {people.map((m, i) => (
              <span key={m.id}>
                {i > 0 && ", "}
                <strong>{m.name}</strong>
                {m.lead && <span style={{ color: "var(--muted)" }}> (lead)</span>}
              </span>
            ))}
            {team && people.length > 0 && !team.lead && (
              <span style={{ color: "var(--warn)" }}> · no lead yet</span>
            )}
          </div>
        </div>
        {team && people.length === 0 && enabledFeatures?.keyDates && (
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.2rem" }}>
            {!canEdit
              ? "Key-date reminders go to the church's default lead until a team is set."
              : defaultLead
                ? `Key-date reminders go to the default lead, ${defaultLead.name}, until a team is set.`
                : "Key-date reminders have nobody to go to until a team (or a default lead) is set."}
          </div>
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

  return (
    // Clicking the card opens the editor; the title button is the keyboard way in.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={canEdit && team ? "admin-section admin-section-clickable" : "admin-section"}
      id="section-care-team"
      style={{ scrollMarginTop: "1rem" }}
      onClick={canEdit && team ? onClickUnlessSelecting(() => setEditing(true)) : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>
          {canEdit && team ? (
            <button
              type="button"
              className="summary-item-link"
              aria-label={team.lead || team.members.length ? "Edit care team" : "+ Assign care team"}
              style={{ font: "inherit", color: "inherit", textDecoration: "none" }}
              onClick={() => setEditing(true)}
            >
              Care team
            </button>
          ) : (
            "Care team"
          )}
        </h3>
      </div>
      {failed && <p style={{ color: "var(--danger)" }}>Couldn't load the care team.</p>}
      {team && !team.lead && team.members.length === 0 && (
        <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
          Nobody is assigned to keep in touch with this partner yet.
          {canEdit && enabledFeatures?.keyDates && (
            <>
              {" "}
              {defaultLead
                ? `Key-date reminders go to the default lead, ${defaultLead.name}, until a team is set.`
                : "Key-date reminders have nobody to go to until a team (or a default lead) is set."}
            </>
          )}
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
            <li style={{ color: "var(--warn)", fontSize: "0.85rem", paddingTop: "0.25rem" }}>No lead yet.</li>
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
                  // .admin-shell label stacks its children in a bold column; a checkbox row
                  // needs the row layout and normal weight (like .admin-checkbox-row).
                  <label
                    key={u.id}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      gap: "0.6rem",
                      alignItems: "center",
                      padding: "0.25rem 0",
                      fontWeight: "normal",
                      fontSize: "0.95rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: "auto", flexShrink: 0 }}
                      checked={memberIds.has(u.id)}
                      onChange={() => toggle(u.id)}
                    />
                    <span>
                      {memberName(u)}
                      {/* an account with no name already shows as its email */}
                      {memberName(u) !== u.email && <span style={{ color: "var(--muted)" }}> {u.email}</span>}
                      {u.role === "guest" && <span style={{ color: "var(--muted)" }}> · Guest</span>}
                    </span>
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
