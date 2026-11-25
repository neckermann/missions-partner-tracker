import React, { useEffect, useState } from "react";
import {
  fetchContactLogOptions,
  fetchContactTimeline,
  fetchContactUpdates,
  fetchPartnerSupportPreferences,
  createContactLogEntry,
  updateContactLogEntry,
  deleteContactLogEntry,
} from "../../api/client.js";
import { Link } from "react-router-dom";
import QuickActionModal from "../shared/QuickActionModal.jsx";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { onClickUnlessSelecting } from "../../utils/clickableRow.js";
import { formatDateLong, toDateInputValue, todayInputValue } from "../../utils/format.js";

// The partner's contact log, newest first. Anyone who can see the partner can log an entry; only
// admin/editor can fix or delete one (`canFix`). The type/direction/topic lists come from the
// server. `entries` is owned by the page; `onChanged` reloads it. `teammates` ([{ userId, name }])
// feeds the "Who" picker when care teams are on ("Me" is the default).

// How many of the newest log entries and filed events the partner page shows.
const RECENT_COUNT = 3;

const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "Someone";

function Chip({ selected, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={selected ? "btn small" : "btn secondary small"}
      style={{ marginRight: "0.4rem", marginBottom: "0.4rem" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const blankForm = () => ({
  contactType: "",
  direction: "outbound",
  topics: [],
  contactedById: "",
  contactDate: todayInputValue(),
  notes: "",
  followUpDate: "",
  supportOptionId: "",
});

export default function ContactLogSection({
  partnerId,
  entries,
  onChanged,
  canFix,
  currentUserId,
  teammates = [],
}) {
  const { enabledFeatures } = useSettings();
  const [options, setOptions] = useState(null);
  // The support menu, so an entry can say which option it was about (staff-only options are
  // already left out for a care team guest by the server).
  const [supportOptions, setSupportOptions] = useState([]);
  const [form, setForm] = useState(null); // null = closed
  const [editingId, setEditingId] = useState(null);
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  // Church visits and newsletters filed, shown as read-only rows. A failure leaves the log alone.
  const [events, setEvents] = useState([]);

  useEffect(() => {
    fetchContactLogOptions().then(setOptions).catch(console.error);
  }, []);
  useEffect(() => {
    if (!enabledFeatures?.supportPreferences) return;
    fetchPartnerSupportPreferences(partnerId)
      .then((d) => setSupportOptions(d.options.filter((o) => o.active)))
      .catch(() => setSupportOptions([]));
  }, [partnerId, enabledFeatures?.supportPreferences]);
  useEffect(() => {
    fetchContactTimeline(partnerId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [partnerId]);

  // A decided need or answered prayer still waiting to be passed on; refreshed when the log changes
  // since logging that you told them clears it.
  const [updates, setUpdates] = useState([]);
  useEffect(() => {
    fetchContactUpdates(partnerId)
      .then(setUpdates)
      .catch(() => setUpdates([]));
  }, [partnerId, entries]);

  const label = (list, value) => list?.find((x) => x.value === value)?.label || value;

  function openAdd() {
    setEditingId(null);
    setForm(blankForm());
  }

  // A prefilled "we reached out" with the right topic ticked, so saving clears the bell item.
  function openThankYou(update) {
    setEditingId(null);
    setForm({ ...blankForm(), direction: "outbound", topics: [update.topic] });
  }

  function openEdit(entry) {
    setEditingId(entry.id);
    setForm({
      contactType: entry.contactType,
      direction: entry.direction,
      topics: entry.topics || [],
      // "Me" is the blank option, so an entry made by the viewer opens as Me.
      contactedById: entry.contactedById && entry.contactedById !== currentUserId ? entry.contactedById : "",
      contactDate: toDateInputValue(entry.contactDate),
      notes: entry.notes || "",
      followUpDate: toDateInputValue(entry.followUpDate),
      supportOptionId: entry.supportOptionId || "",
    });
  }

  function close() {
    setForm(null);
    setEditingId(null);
  }

  async function submit() {
    if (!form.contactType) throw new Error("Choose what kind of contact it was");
    const payload = {
      contactType: form.contactType,
      direction: form.direction,
      topics: form.topics,
      contactDate: form.contactDate || undefined,
      notes: form.notes.trim() || null,
      followUpDate: form.followUpDate || null,
      supportOptionId: form.supportOptionId || null,
      // "Me" is the server's default; only send someone else when picked.
      ...(form.contactedById && form.contactedById !== currentUserId
        ? { contactedById: form.contactedById }
        : {}),
    };
    if (editingId) {
      await updateContactLogEntry(editingId, {
        ...payload,
        contactedById: form.contactedById || currentUserId || null,
      });
    } else {
      await createContactLogEntry({ partnerId, ...payload });
    }
    onChanged();
  }

  async function handleDelete(entry) {
    const ok = await confirmDialog({
      title: "Delete this contact entry?",
      body: (
        <ConfirmMessageBody>
          {label(options?.types, entry.contactType)} on {formatDateLong(entry.contactDate)} will be removed
          from the log.
        </ConfirmMessageBody>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return false;
    await deleteContactLogEntry(entry.id);
    onChanged();
    return true;
  }

  const toggleTopic = (value) =>
    setForm((f) => ({
      ...f,
      topics: f.topics.includes(value) ? f.topics.filter((t) => t !== value) : [...f.topics, value],
    }));

  const whoOptions = [
    { id: "", label: "Me" },
    ...teammates.filter((t) => t.userId !== currentUserId).map((t) => ({ id: t.userId, label: t.name })),
  ];

  const renderEntry = (e) => (
    // A fixable entry is itself the click target (opens the edit popup, which carries Delete).

    <div
      key={e.id}
      className={canFix ? "repeatable-row repeatable-row-clickable" : "repeatable-row"}
      style={{ marginTop: "0.75rem" }}
      role={canFix ? "button" : undefined}
      tabIndex={canFix ? 0 : undefined}
      onClick={canFix ? onClickUnlessSelecting(() => openEdit(e)) : undefined}
      onKeyDown={
        canFix
          ? (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                openEdit(e);
              }
            }
          : undefined
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <strong>{label(options?.types, e.contactType)}</strong>
          {" · "}
          <span>{label(options?.directions, e.direction)}</span>
          {" · "}
          <span>{formatDateLong(e.contactDate)}</span>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            by {nameOf(e.contactedBy)}
            {e.topics?.length > 0 && <> · {e.topics.map((t) => label(options?.topics, t)).join(", ")}</>}
            {e.supportOptionLabel && <> · re: {e.supportOptionLabel}</>}
          </div>
        </div>
      </div>
      {e.notes && <p style={{ margin: "0.4rem 0 0", whiteSpace: "pre-wrap" }}>{e.notes}</p>}
      {e.followUpDate && (
        <div style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
          Follow up by {formatDateLong(e.followUpDate)}
        </div>
      )}
    </div>
  );

  // The log's own entries and the read-only events, newest first.
  const timeline = [
    ...entries.map((entry) => ({ entry, date: String(entry.contactDate).slice(0, 10) })),
    ...events.map((event) => ({ event, date: event.date })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  // Only the latest few show here, so the partner page doesn't grow with every contact; the rest
  // are on the Contact Log page, already filtered to this partner.
  const recent = timeline.slice(0, RECENT_COUNT);
  const hiddenEntries = entries.length - recent.filter((i) => i.entry).length;

  return (
    <div className="admin-section" id="contact-log">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          <span aria-hidden="true">💬 </span>Contact Log
        </h3>
        <button type="button" className="btn secondary small" onClick={openAdd}>
          + Log contact
        </button>
      </div>

      {updates.length > 0 && (
        <div
          role="status"
          style={{
            margin: "0.75rem 0 0",
            padding: "0.6rem 0.75rem",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface-2)",
          }}
        >
          <strong>Updates to pass on</strong>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0" }}>
            {updates.map((u) => (
              <li
                key={`${u.kind}:${u.id}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "0.5rem 0.75rem",
                  padding: "0.2rem 0",
                }}
              >
                <span>
                  {u.kind === "need" ? "A need was decided" : "A prayer was answered"} (
                  {formatDateLong(u.date)}
                  ): {u.label}
                </span>
                <button
                  type="button"
                  className="btn secondary small"
                  style={{ whiteSpace: "nowrap" }}
                  onClick={() => openThankYou(u)}
                >
                  Log that I told them
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {timeline.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>No contact logged yet.</p>
      ) : (
        recent.map((item) =>
          item.event ? (
            <div key={item.event.id} className="repeatable-row" style={{ marginTop: "0.75rem" }}>
              <strong>{item.event.title}</strong>
              {" · "}
              <span>{formatDateLong(item.event.date)}</span>
              {item.event.detail && (
                <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{item.event.detail}</div>
              )}
            </div>
          ) : (
            renderEntry(item.entry)
          )
        )
      )}

      {hiddenEntries > 0 && (
        <p style={{ margin: "0.75rem 0 0" }}>
          <Link to={`/admin/contact-log?partnerId=${partnerId}`}>
            View all {entries.length} logged contacts →
          </Link>
        </p>
      )}

      {form && options && (
        <QuickActionModal
          title={editingId ? "Edit contact" : "Log a contact"}
          onClose={close}
          onDelete={
            editingId && canFix
              ? () => handleDelete(entries.find((x) => x.id === editingId) || { id: editingId })
              : undefined
          }
          onSubmit={submit}
        >
          <fieldset style={{ border: 0, padding: 0, margin: "0 0 0.75rem" }}>
            <legend style={{ fontWeight: 600, marginBottom: "0.4rem" }}>What happened</legend>
            {options.types.map((t) => (
              <Chip
                key={t.value}
                selected={form.contactType === t.value}
                onClick={() => setForm((f) => ({ ...f, contactType: t.value }))}
              >
                {t.label}
              </Chip>
            ))}
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: "0 0 0.75rem" }}>
            <legend style={{ fontWeight: 600, marginBottom: "0.4rem" }}>Who reached out</legend>
            {options.directions.map((d) => (
              <Chip
                key={d.value}
                selected={form.direction === d.value}
                onClick={() => setForm((f) => ({ ...f, direction: d.value }))}
              >
                {d.label}
              </Chip>
            ))}
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: "0 0 0.75rem" }}>
            <legend style={{ fontWeight: 600, marginBottom: "0.4rem" }}>About (optional)</legend>
            {options.topics.map((t) => (
              <Chip
                key={t.value}
                selected={form.topics.includes(t.value)}
                onClick={() => toggleTopic(t.value)}
              >
                {t.label}
              </Chip>
            ))}
          </fieldset>

          {supportOptions.length > 0 && (
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              Which support option was this about? (optional)
              <select
                value={form.supportOptionId}
                onChange={(e) => setForm((f) => ({ ...f, supportOptionId: e.target.value }))}
              >
                <option value="">None</option>
                {supportOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.group}: {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="form-grid">
            <label>
              Date
              <input
                type="date"
                value={form.contactDate}
                onChange={(e) => setForm((f) => ({ ...f, contactDate: e.target.value }))}
                required
              />
            </label>
            {whoOptions.length > 1 && (
              <label>
                Who
                <select
                  value={form.contactedById}
                  onChange={(e) => setForm((f) => ({ ...f, contactedById: e.target.value }))}
                >
                  {whoOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Follow up by (optional)
              <input
                type="date"
                value={form.followUpDate}
                onChange={(e) => setForm((f) => ({ ...f, followUpDate: e.target.value }))}
              />
            </label>
          </div>
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            Note (optional)
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
        </QuickActionModal>
      )}
      {confirmElement}
    </div>
  );
}
