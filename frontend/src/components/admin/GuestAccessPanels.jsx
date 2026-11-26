import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchUserTripAccess,
  fetchTripGuests,
  fetchUsers,
  addUserTripAccess,
  setUserTripAccessExpiry,
  removeUserTripAccess,
} from "../../api/client.js";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";
import { mapServerErrorMessage } from "../../utils/friendlyError.js";
import TripAccessList from "./TripAccessList.jsx";
import { tripOptionLabel } from "./TripGrantPicker.jsx";

// Admin-only screens for the grants behind a guest login, reachable per guest (Users page) and per
// trip (the trip's page); both share one set of actions. Changes go through the grant endpoints in
// routes/users.js and take effect on the guest's next request.

function guestName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

// Shared actions. `reload` re-fetches the panel's list; `userIdOf` resolves a row's guest.
function useGrantActions({ reload, userIdOf, onChanged, setError }) {
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
      onChanged?.();
    } catch (err) {
      setError(mapServerErrorMessage(err?.response?.data?.error) || "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    confirmElement,
    run,
    onExtend: (g, date) => run(() => setUserTripAccessExpiry(userIdOf(g), g.tripId, date)),
    onResetDate: (g) => run(() => setUserTripAccessExpiry(userIdOf(g), g.tripId, null)),
    onEndNow: async (g) => {
      const ok = await confirmDialog({
        title: "End access now?",
        body: (
          <ConfirmMessageBody>They'll be signed out of this trip on their next click.</ConfirmMessageBody>
        ),
        confirmLabel: "End access",
        danger: true,
      });
      if (ok) run(() => setUserTripAccessExpiry(userIdOf(g), g.tripId, new Date().toISOString()));
    },
    onRemove: async (g, { isLast } = {}) => {
      const ok = await confirmDialog({
        title: "Remove this access?",
        body: (
          <ConfirmMessageBody>
            {isLast
              ? "This is their last trip, so the account will be deactivated (not deleted). You can find it under Inactive accounts."
              : "They will no longer be able to open this trip."}
          </ConfirmMessageBody>
        ),
        confirmLabel: "Remove",
        danger: true,
      });
      if (ok) run(() => removeUserTripAccess(userIdOf(g), g.tripId));
    },
  };
}

// The trips one guest can reach, with an "add a trip" picker.
export function GuestGrantsPanel({ userId, trips, onChanged }) {
  const [grants, setGrants] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pick, setPick] = useState("");

  const reload = useCallback(
    () =>
      fetchUserTripAccess(userId)
        .then(setGrants)
        .catch(() => setError("Couldn't load this account's trips.")),
    [userId]
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const actions = useGrantActions({ reload, userIdOf: () => userId, onChanged, setError });
  if (!grants) return <p style={{ color: "var(--muted)" }}>Loading trips…</p>;

  const granted = new Set(grants.map((g) => g.tripId));
  const addable = trips.filter((t) => !granted.has(t.id));
  const tripById = new Map(trips.map((t) => [t.id, t]));

  return (
    <div>
      <TripAccessList
        grants={grants}
        busy={actions.busy}
        labelFor={(g) =>
          tripById.has(g.tripId) ? tripOptionLabel(tripById.get(g.tripId)) : g.trip.name || "Trip"
        }
        onExtend={actions.onExtend}
        onResetDate={actions.onResetDate}
        onEndNow={actions.onEndNow}
        onRemove={(g) => actions.onRemove(g, { isLast: grants.length === 1 })}
      />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginTop: "0.75rem" }}>
        <label style={{ flex: 1 }}>
          Add a trip
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{addable.length ? "Choose a trip…" : "No more trips to add"}</option>
            {addable.map((t) => (
              <option key={t.id} value={t.id}>
                {tripOptionLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn small"
          disabled={!pick || actions.busy}
          onClick={() =>
            actions.run(async () => {
              const res = await addUserTripAccess(userId, { tripId: pick });
              setPick("");
              setNote(
                res.accountActive
                  ? ""
                  : "This account is deactivated, so the new access won't work until you tick Active and save."
              );
            })
          }
        >
          Add
        </button>
      </div>
      {note && <p style={{ color: "var(--muted)" }}>{note}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {actions.confirmElement}
    </div>
  );
}

// The guests who can reach one trip, with "add an existing guest" and a
// link into the Add User wizard (preset to this trip) for a new one.
export function TripGuestsPanel({ tripId }) {
  const [rows, setRows] = useState(null);
  const [guests, setGuests] = useState([]);
  const [error, setError] = useState("");
  const [pick, setPick] = useState("");

  const reload = useCallback(
    () =>
      Promise.all([fetchTripGuests(tripId), fetchUsers()])
        .then(([grants, users]) => {
          setRows(grants);
          setGuests(users.filter((u) => u.role === "guest"));
        })
        .catch(() => setError("Couldn't load guest access.")),
    [tripId]
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const actions = useGrantActions({ reload, userIdOf: (g) => g.user.id, setError });
  if (!rows) return <p style={{ color: "var(--muted)" }}>Loading guest access…</p>;

  const has = new Set(rows.map((r) => r.user.id));
  const addable = guests.filter((u) => !has.has(u.id));

  return (
    <div>
      <TripAccessList
        grants={rows}
        busy={actions.busy}
        labelFor={(g) => [guestName(g.user), g.user.phone].filter(Boolean).join(" · ")}
        onExtend={actions.onExtend}
        onResetDate={actions.onResetDate}
        onEndNow={actions.onEndNow}
        onRemove={(g) => {
          const guest = guests.find((u) => u.id === g.user.id);
          return actions.onRemove(g, { isLast: (guest?.tripAccess?.length ?? 2) === 1 });
        }}
      />
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-end",
          marginTop: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <label style={{ flex: "1 1 14rem" }}>
          Give an existing guest access
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{addable.length ? "Choose a guest…" : "No other guests"}</option>
            {addable.map((u) => (
              <option key={u.id} value={u.id}>
                {guestName(u)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn small"
          disabled={!pick || actions.busy}
          onClick={() =>
            actions.run(async () => {
              await addUserTripAccess(pick, { tripId });
              setPick("");
            })
          }
        >
          Add
        </button>
        <Link className="btn secondary small" to={`/admin/settings/users/new?tripId=${tripId}`}>
          Invite a new guest
        </Link>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {actions.confirmElement}
    </div>
  );
}
