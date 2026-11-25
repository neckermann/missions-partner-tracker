import React, { useCallback, useEffect, useState } from "react";
import {
  fetchSupportOptions,
  fetchSupportKinds,
  createSupportOption,
  updateSupportOption,
  deleteSupportOption,
  renameSupportGroup,
  addSupportExampleSet,
} from "../api/client.js";
import { Link } from "react-router-dom";
import SuggestInput from "../components/SuggestInput.jsx";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import { groupOptions } from "../components/admin/SupportPreferencesCard.jsx";

// The church's menu of ways to support a partner: data the church owns, never code. Each
// option has a group (plain text, renamable), a label, and a kind (offer, pick one, pick any,
// free text). Retiring an option stops it being offered but keeps answers already given;
// deleting it removes those answers too. Admin only.
export default function AdminSettingsSupportPreferences() {
  const [options, setOptions] = useState(null);
  const [kinds, setKinds] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // an option, or {} for a new one
  const [renaming, setRenaming] = useState(null); // a group name
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();

  const reload = useCallback(
    () =>
      fetchSupportOptions()
        .then((o) => {
          setOptions(o);
          setError("");
        })
        .catch(() => setError("Couldn't load the support options.")),
    []
  );
  useEffect(() => {
    reload();
    fetchSupportKinds().then(setKinds).catch(console.error);
  }, [reload]);

  async function act(fn) {
    setError("");
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    }
  }

  async function remove(option) {
    const ok = await confirmDialog({
      title: "Delete this option?",
      body: (
        <p>
          <strong>{option.label}</strong> will be removed
          {option.answerCount > 0
            ? `, along with the ${option.answerCount} partner${option.answerCount === 1 ? "" : "s"}' answers to it. To stop offering it but keep the answers, retire it instead.`
            : "."}
        </p>
      ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) act(() => deleteSupportOption(option.id));
  }

  const groups = groupOptions(options || []);
  const kindLabel = (v) => kinds.find((k) => k.value === v)?.label || v;

  return (
    <div className="admin-shell">
      <SettingsPageHeader
        title="Support Preferences"
        actions={
          options?.some((o) => o.active) ? (
            <Link to="/admin/settings/support-preferences/print" className="btn secondary">
              Print menu
            </Link>
          ) : null
        }
      />
      <p style={{ color: "var(--muted)" }}>
        The menu of ways your church and a partner&apos;s care team can support them. Each partner&apos;s
        choices from it are recorded on their page, and are only ever seen by staff and their care team.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {options && options.length === 0 && (
        <div className="admin-section">
          <p style={{ marginTop: 0 }}>
            There are no options yet. Start from an example set (housing, transportation, prayer, care
            packages and so on) and edit it, or build your own.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => act(addSupportExampleSet)}>
              Add an example set
            </button>
            <button type="button" className="btn secondary" onClick={() => setEditing({})}>
              + Add an option
            </button>
          </div>
        </div>
      )}

      {options && options.length > 0 && (
        <div style={{ margin: "0 0 1rem" }}>
          <button type="button" className="btn" onClick={() => setEditing({})}>
            + Add an option
          </button>
        </div>
      )}

      {groups.map((g) => (
        <div className="admin-section-group" key={g.name}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="admin-group-heading" style={{ margin: 0 }}>
              {g.name}
            </h2>
            <button type="button" className="btn secondary small" onClick={() => setRenaming(g.name)}>
              Rename group
            </button>
          </div>
          <div className="admin-section" style={{ overflowX: "auto" }}>
            {/* Fixed columns, so every group's table lines up with the others. */}
            <table className="admin-table" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col />
                <col style={{ width: "28%" }} />
                <col style={{ width: "5.5rem" }} />
                <col style={{ width: "13.5rem" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Kind</th>
                  <th>Answers</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.options.map((o) => (
                  <tr key={o.id} style={o.active ? undefined : { opacity: 0.6 }}>
                    <td>
                      {o.label}
                      {!o.active && <span style={{ color: "var(--muted)" }}> · retired</span>}
                      {o.staffOnly && <span style={{ color: "var(--muted)" }}> · staff only</span>}
                      {o.choices.length > 0 && (
                        <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                          {o.choices.join(" · ")}
                          {o.allowOther ? " · other" : ""}
                        </div>
                      )}
                    </td>
                    <td>{kindLabel(o.kind)}</td>
                    <td>{o.answerCount}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn secondary small" onClick={() => setEditing(o)}>
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => act(() => updateSupportOption(o.id, { active: !o.active }))}
                      >
                        {o.active ? "Retire" : "Restore"}
                      </button>{" "}
                      <button type="button" className="btn danger small" onClick={() => remove(o)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {editing && (
        <OptionModal
          option={editing}
          kinds={kinds}
          groupNames={groups.map((g) => g.name)}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {renaming && <RenameGroupModal group={renaming} onClose={() => setRenaming(null)} onSaved={reload} />}
      {confirmElement}
    </div>
  );
}

function OptionModal({ option, kinds, groupNames, onClose, onSaved }) {
  const isNew = !option.id;
  const [form, setForm] = useState({
    group: option.group ?? groupNames[0] ?? "",
    label: option.label ?? "",
    kind: option.kind ?? "offer",
    choicesText: (option.choices ?? []).join("\n"),
    allowOther: option.allowOther ?? false,
    staffOnly: option.staffOnly ?? false,
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const isChoice = form.kind === "single" || form.kind === "multiple";

  async function handleSubmit() {
    const body = {
      group: form.group,
      label: form.label,
      kind: form.kind,
      choices: isChoice
        ? form.choicesText
            .split("\n")
            .map((c) => c.trim())
            .filter(Boolean)
        : [],
      allowOther: isChoice ? form.allowOther : false,
      staffOnly: form.staffOnly,
    };
    if (isNew) await createSupportOption(body);
    else await updateSupportOption(option.id, body);
    await onSaved();
  }

  return (
    <QuickActionModal
      title={isNew ? "Add an option" : "Edit option"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitDisabled={!form.group.trim() || !form.label.trim()}
    >
      <label>
        Group
        <SuggestInput value={form.group} onChange={(v) => set({ group: v })} options={groupNames} required />
      </label>
      <label>
        What it says
        <input value={form.label} onChange={(e) => set({ label: e.target.value })} required />
      </label>
      <label>
        Kind
        <select
          value={form.kind}
          onChange={(e) => set({ kind: e.target.value })}
          disabled={option.answerCount > 0}
        >
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {option.answerCount > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
          Partners have answered this, so its kind can&apos;t change. Retire it and add a new one instead.
        </p>
      )}
      {isChoice && (
        <>
          <label>
            Choices (one per line)
            <textarea
              rows={4}
              value={form.choicesText}
              onChange={(e) => set({ choicesText: e.target.value })}
            />
          </label>
          <label style={{ flexDirection: "row", gap: "0.6rem", alignItems: "center", fontWeight: "normal" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={form.allowOther}
              onChange={(e) => set({ allowOther: e.target.checked })}
            />
            Let them write their own answer too
          </label>
        </>
      )}
      <label style={{ flexDirection: "row", gap: "0.6rem", alignItems: "center", fontWeight: "normal" }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={form.staffOnly}
          onChange={(e) => set({ staffOnly: e.target.checked })}
        />
        Staff only: hide this option and its answers from care team guests
      </label>
    </QuickActionModal>
  );
}

function RenameGroupModal({ group, onClose, onSaved }) {
  const [name, setName] = useState(group);
  return (
    <QuickActionModal
      title="Rename group"
      onClose={onClose}
      onSubmit={async () => {
        await renameSupportGroup(group, name.trim());
        await onSaved();
      }}
      submitDisabled={!name.trim() || name.trim() === group}
    >
      <label>
        Group name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
    </QuickActionModal>
  );
}
