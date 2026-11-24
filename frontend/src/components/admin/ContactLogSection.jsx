import React, { useEffect, useState } from "react";
import {
  fetchContactLogOptions,
  createContactLogEntry,
  updateContactLogEntry,
  deleteContactLogEntry,
} from "../../api/client.js";
import QuickActionModal from "../shared/QuickActionModal.jsx";
import useConfirmDialog from "../../hooks/useConfirmDialog.jsx";
import ConfirmMessageBody from "../ConfirmMessageBody.jsx";
import { formatDateLong, toDateInputValue, todayInputValue } from "../../utils/format.js";

// The partner's contact log (#288): every call, text, visit or card, newest
// first. Anyone who can see the partner can log one (quick chips, not a long
// form); only admin/editor can fix or delete an entry (`canFix`). The fixed
// type / direction / topic lists come from the server, so nothing here keeps a
// copy that could drift.
//
// `entries` is owned by the page (the contact card at the top reads the same
// list); `onChanged` reloads it. `teammates` ([{ userId, name }]) feeds the
// "Who" picker when care teams are on -- "Me" is always there and the default.

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
});

export default function ContactLogSection({
  partnerId,
  entries,
  onChanged,
  canFix,
  currentUserId,
  teammates = [],
}) {
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(null); // null = closed
  const [editingId, setEditingId] = useState(null);
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  useEffect(() => {
    fetchContactLogOptions().then(setOptions).catch(console.error);
  }, []);

  const label = (list, value) => list?.find((x) => x.value === value)?.label || value;

  function openAdd() {
    setEditingId(null);
    setForm(blankForm());
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
    if (!ok) return;
    await deleteContactLogEntry(entry.id);
    onChanged();
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

      {entries.length === 0 ? (
        <p style={{ color: "#888", marginTop: "0.5rem" }}>No contact logged yet.</p>
      ) : (
        entries.map((e) => (
          <div key={e.id} className="repeatable-row" style={{ marginTop: "0.75rem" }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}
            >
              <div>
                <strong>{label(options?.types, e.contactType)}</strong>
                {" · "}
                <span>{label(options?.directions, e.direction)}</span>
                {" · "}
                <span>{formatDateLong(e.contactDate)}</span>
                <div style={{ fontSize: "0.85rem", color: "#666" }}>
                  by {nameOf(e.contactedBy)}
                  {e.topics?.length > 0 && (
                    <> · {e.topics.map((t) => label(options?.topics, t)).join(", ")}</>
                  )}
                </div>
              </div>
              {canFix && (
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button type="button" className="btn secondary small" onClick={() => openEdit(e)}>
                    Edit
                  </button>
                  <button type="button" className="btn secondary small" onClick={() => handleDelete(e)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
            {e.notes && <p style={{ margin: "0.4rem 0 0", whiteSpace: "pre-wrap" }}>{e.notes}</p>}
            {e.followUpDate && (
              <div style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
                Follow up by {formatDateLong(e.followUpDate)}
              </div>
            )}
          </div>
        ))
      )}

      {form && options && (
        <QuickActionModal
          title={editingId ? "Edit contact" : "Log a contact"}
          onClose={close}
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
