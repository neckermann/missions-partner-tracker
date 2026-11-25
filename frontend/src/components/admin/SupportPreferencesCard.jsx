import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPartnerSupportPreferences, savePartnerSupportPreferences } from "../../api/client.js";
import { formatDate } from "../../utils/format.js";
import QuickActionModal from "../shared/QuickActionModal.jsx";

// A partner's support preferences (#374): which of the church's menu of ways to support a
// partner they have chosen, their answers, and a note. One set per partner. Recorded by staff
// or the care team after a conversation; never shown publicly. Renders nothing when the feature
// is off, or for someone who can't reach it (a trip leader): the API answers 403/404.

// Groups an ordered list of options by their group name, keeping the order they arrive in.
export function groupOptions(options) {
  const groups = [];
  for (const o of options) {
    let g = groups.find((x) => x.name === o.group);
    if (!g) groups.push((g = { name: o.group, options: [] }));
    g.options.push(o);
  }
  return groups;
}

// "Yes", the choice picked, the choices joined, or what they wrote.
export function describeResponse(option, pref) {
  if (!pref) return "";
  if (option.kind === "offer") return pref.selected ? "Yes" : "";
  if (option.kind === "text") return pref.text || "";
  if (option.kind === "single") return pref.choice || pref.other || "";
  return [...(pref.choices || []), ...(pref.other ? [pref.other] : [])].join(", ");
}

const rowLabel = {
  display: "flex",
  flexDirection: "row",
  gap: "0.6rem",
  alignItems: "center",
  padding: "0.2rem 0",
  fontWeight: "normal",
  fontSize: "0.95rem",
};

export default function SupportPreferencesCard({ partnerId, isAdmin = false }) {
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(
    () =>
      fetchPartnerSupportPreferences(partnerId)
        .then((d) => {
          setData(d);
          setFailed(false);
        })
        .catch((err) => {
          const status = err.response?.status;
          if (status === 403 || status === 404) setHidden(true);
          else setFailed(true);
        }),
    [partnerId]
  );
  useEffect(() => {
    setHidden(false);
    reload();
  }, [reload]);

  if (hidden) return null;

  const byOption = new Map((data?.preferences || []).map((p) => [p.optionId, p]));
  const answered = (data?.options || []).filter(
    (o) => describeResponse(o, byOption.get(o.id)) || byOption.get(o.id)?.note
  );
  const groups = groupOptions(answered);
  const hasMenu = (data?.options || []).some((o) => o.active);

  return (
    <div className="admin-section" id="section-support-preferences" style={{ scrollMarginTop: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Support preferences</h3>
        {data?.canEdit && hasMenu && (
          <button type="button" className="btn secondary small" onClick={() => setEditing(true)}>
            {answered.length ? "Edit preferences" : "+ Record preferences"}
          </button>
        )}
      </div>
      {failed && <p style={{ color: "var(--danger)" }}>Couldn&apos;t load the support preferences.</p>}
      {data && !hasMenu && (
        <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
          No support options have been set up yet.
          {isAdmin && (
            <>
              {" "}
              <Link to="/admin/settings/support-preferences">Set up the menu</Link>
            </>
          )}
        </p>
      )}
      {data && hasMenu && answered.length === 0 && (
        <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>
          Nothing recorded yet. After a conversation, record how this partner would like to be supported.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.name} style={{ marginTop: "0.75rem" }}>
          <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--muted)" }}>{g.name}</div>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.25rem 0 0" }}>
            {g.options.map((o) => {
              const pref = byOption.get(o.id);
              const text = describeResponse(o, pref);
              return (
                <li key={o.id} style={{ padding: "0.2rem 0" }}>
                  {o.kind === "offer" ? (
                    <span>✓ {o.label}</span>
                  ) : (
                    <span>
                      {o.label}: <strong>{text || "—"}</strong>
                    </span>
                  )}
                  {!o.active && <span style={{ color: "var(--muted)" }}> · no longer offered</span>}
                  {pref?.note && <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{pref.note}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {data && answered.length > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.75rem 0 0" }}>
          {lastEditedLine(data.preferences)}
        </p>
      )}
      {editing && data && (
        <EditSupportPreferencesModal
          partnerId={partnerId}
          options={data.options}
          preferences={data.preferences}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

// "Last updated by Dana on 11/24/2026" from the most recent edit across the responses.
function lastEditedLine(preferences) {
  const edited = preferences
    .filter((p) => p.lastEditedAt && p.lastEditedByName)
    .sort((a, b) => new Date(b.lastEditedAt) - new Date(a.lastEditedAt))[0];
  return edited ? `Last updated by ${edited.lastEditedByName} on ${formatDate(edited.lastEditedAt)}` : "";
}

function EditSupportPreferencesModal({ partnerId, options, preferences, onClose, onSaved }) {
  const existing = new Map(preferences.map((p) => [p.optionId, p]));
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(
      options.map((o) => {
        const p = existing.get(o.id);
        return [
          o.id,
          {
            selected: p?.selected ?? false,
            choice: p?.choice ?? "",
            choices: p?.choices ?? [],
            other: p?.other ?? "",
            text: p?.text ?? "",
            note: p?.note ?? "",
          },
        ];
      })
    )
  );
  const set = (id, patch) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  async function handleSubmit() {
    const body = options.map((o) => {
      const d = draft[o.id];
      return {
        optionId: o.id,
        selected: d.selected,
        choice: d.choice || null,
        choices: d.choices,
        other: d.other || null,
        text: d.text || null,
        note: d.note || null,
      };
    });
    await savePartnerSupportPreferences(partnerId, body);
    await onSaved();
  }

  return (
    <QuickActionModal title="Support preferences" onClose={onClose} onSubmit={handleSubmit} maxWidth="640px">
      <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
        Record what this partner has asked for. Only the care team and staff can see this.
      </p>
      {groupOptions(options).map((g) => (
        <fieldset key={g.name} style={{ border: "none", padding: 0, margin: "0 0 1rem" }}>
          <legend style={{ fontWeight: 600 }}>{g.name}</legend>
          {g.options.map((o) => (
            <OptionField key={o.id} option={o} value={draft[o.id]} onChange={(patch) => set(o.id, patch)} />
          ))}
        </fieldset>
      ))}
    </QuickActionModal>
  );
}

function OptionField({ option, value, onChange }) {
  const retired = !option.active ? " (no longer offered)" : "";
  const noteField = (
    <input
      type="text"
      aria-label={`Note for ${option.label}`}
      placeholder="Note (optional)"
      value={value.note}
      onChange={(e) => onChange({ note: e.target.value })}
      style={{ marginTop: "0.25rem" }}
    />
  );

  let control;
  if (option.kind === "offer") {
    control = (
      <label style={rowLabel}>
        <input
          type="checkbox"
          style={{ width: "auto", flexShrink: 0 }}
          checked={value.selected}
          onChange={(e) => onChange({ selected: e.target.checked })}
        />
        <span>
          {option.label}
          {retired}
        </span>
      </label>
    );
  } else if (option.kind === "text") {
    control = (
      <label>
        {option.label}
        {retired}
        <textarea rows={2} value={value.text} onChange={(e) => onChange({ text: e.target.value })} />
      </label>
    );
  } else if (option.kind === "single") {
    control = (
      <label>
        {option.label}
        {retired}
        <select value={value.choice} onChange={(e) => onChange({ choice: e.target.value, other: "" })}>
          <option value="">Not answered</option>
          {option.choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {option.allowOther && (
          <input
            type="text"
            aria-label={`Other answer for ${option.label}`}
            placeholder="Or something else"
            value={value.other}
            onChange={(e) => onChange({ other: e.target.value, choice: "" })}
            style={{ marginTop: "0.25rem" }}
          />
        )}
      </label>
    );
  } else {
    control = (
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          {option.label}
          {retired}
        </legend>
        {option.choices.map((c) => (
          <label key={c} style={rowLabel}>
            <input
              type="checkbox"
              style={{ width: "auto", flexShrink: 0 }}
              checked={value.choices.includes(c)}
              onChange={(e) =>
                onChange({
                  choices: e.target.checked ? [...value.choices, c] : value.choices.filter((x) => x !== c),
                })
              }
            />
            <span>{c}</span>
          </label>
        ))}
        {option.allowOther && (
          <input
            type="text"
            aria-label={`Other answer for ${option.label}`}
            placeholder="Or something else"
            value={value.other}
            onChange={(e) => onChange({ other: e.target.value })}
          />
        )}
      </fieldset>
    );
  }

  return (
    <div style={{ padding: "0.35rem 0" }}>
      {control}
      {noteField}
    </div>
  );
}
