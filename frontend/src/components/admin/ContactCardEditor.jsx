import React, { useState } from "react";
import EmailInput from "../../components/shared/EmailInput.jsx";
import PhoneField from "../../components/shared/PhoneField.jsx";
import { formatPhone } from "../../utils/phone.js";
import Modal from "../Modal.jsx";
import { updateAdult, updatePartner } from "../../api/client.js";
import { toDateInputValue } from "../../utils/format.js";
import { primaryContactOf } from "../../utils/contactActions.js";
import { CONTACT_LEVELS, CONTACT_METHODS, contactLevelOf } from "../../utils/contactMethods.js";
import { mapServerErrorMessage } from "../../utils/friendlyError.js";

// The popup behind the contact card's Edit button: who to reach first, how they like to be
// reached, and (for staff) how careful to be with this partner. An organization has one named
// contact, so there is no one to pick; the way to reach it is saved on the partner itself.
export default function ContactCardEditor({ partner, adults, canEditCare, onClose, onSaved }) {
  const isOrg = partner.kind === "organization";
  const current = primaryContactOf(partner, adults);
  const [adultId, setAdultId] = useState(current?.adultId || adults[0]?.id || "");
  const selectedAdult = adults.find((a) => a.id === adultId);
  const [method, setMethod] = useState(
    isOrg ? partner.contactMethod || "" : selectedAdult?.contactMethod || ""
  );
  const [note, setNote] = useState(
    isOrg ? partner.contactMethodNote || "" : selectedAdult?.contactMethodNote || ""
  );
  const [level, setLevel] = useState(contactLevelOf(partner));
  const [channels, setChannels] = useState(partner.contactChannels || []);
  const [instructions, setInstructions] = useState(partner.contactInstructions || "");
  const [via, setVia] = useState({
    name: partner.contactViaName || "",
    role: partner.contactViaRole || "",
    phone: formatPhone(partner.contactViaPhone),
    email: partner.contactViaEmail || "",
  });
  // "Not this season": the partner is not called quiet until this day (yyyy-mm-dd, blank = no snooze).
  const [snooze, setSnooze] = useState(
    partner.contactSnoozedUntil ? toDateInputValue(partner.contactSnoozedUntil) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Picking another adult shows how that person likes to be reached.
  function pickAdult(id) {
    setAdultId(id);
    const a = adults.find((x) => x.id === id);
    setMethod(a?.contactMethod || "");
    setNote(a?.contactMethodNote || "");
  }

  const toggleChannel = (value) =>
    setChannels((cs) => (cs.includes(value) ? cs.filter((c) => c !== value) : [...cs, value]));
  const orNull = (v) => (v.trim() ? v.trim() : null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const methodFields = {
        contactMethod: method || null,
        contactMethodNote: method === "other" ? orNull(note) : null,
      };
      if (isOrg) {
        await updatePartner(partner.id, methodFields);
      } else if (adultId) {
        await updateAdult(adultId, { isPrimaryContact: true, ...methodFields });
      }
      if (canEditCare && !isOrg) {
        await updatePartner(partner.id, {
          contactLevel: level,
          contactChannels: level === "caution" ? channels : [],
          contactInstructions: level === "normal" ? null : orNull(instructions),
          contactViaName: level === "no_direct" ? orNull(via.name) : null,
          contactViaRole: level === "no_direct" ? orNull(via.role) : null,
          contactViaPhone: level === "no_direct" ? orNull(via.phone) : null,
          contactViaEmail: level === "no_direct" ? orNull(via.email) : null,
        });
      }
      const savedSnooze = partner.contactSnoozedUntil ? toDateInputValue(partner.contactSnoozedUntil) : "";
      if (snooze !== savedSnooze) await updatePartner(partner.id, { contactSnoozedUntil: snooze || null });
      onSaved();
    } catch (err) {
      setError(mapServerErrorMessage(err?.response?.data?.error) || "Couldn't save the contact details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit contact" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        {!isOrg && adults.length > 1 && (
          <label>
            Reach first
            <select value={adultId} onChange={(e) => pickAdult(e.target.value)}>
              {adults.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.firstName, a.lastName].filter(Boolean).join(" ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {!isOrg && adults.length === 0 && (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Add an adult under Family &amp; Personal first, to set who to reach and how.
          </p>
        )}

        {(isOrg || adults.length > 0) && (
          <>
            <label>
              How they like to be reached
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Not set</option>
                {CONTACT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {method === "other" && (
              <label>
                Which way?
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Telegram"
                />
              </label>
            )}
          </>
        )}

        {canEditCare && !isOrg && (
          <fieldset
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "0.75rem",
            }}
          >
            <legend style={{ padding: "0 0.4rem" }}>How careful to be</legend>
            {CONTACT_LEVELS.map((l) => (
              <label
                key={l.value}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  marginBottom: "0.4rem",
                }}
              >
                <input
                  type="radio"
                  name="contactLevel"
                  value={l.value}
                  checked={level === l.value}
                  onChange={() => setLevel(l.value)}
                  style={{ width: "auto", marginTop: "0.25rem" }}
                />
                <span>
                  <strong>{l.label}</strong>
                  <span style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)" }}>
                    {l.hint}
                  </span>
                </span>
              </label>
            ))}

            {level === "caution" && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>
                  Only reach them by (leave all unticked for any way):
                </div>
                <div className="admin-checkbox-row">
                  {CONTACT_METHODS.filter((m) => m.value !== "other").map((m) => (
                    <label key={m.value} style={{ flexDirection: "row", gap: "0.4rem" }}>
                      <input
                        type="checkbox"
                        checked={channels.includes(m.value)}
                        onChange={() => toggleChannel(m.value)}
                        style={{ width: "auto" }}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {level === "no_direct" && (
              <div className="form-grid" style={{ marginTop: "0.5rem" }}>
                <label>
                  Go through (name)
                  <input
                    value={via.name}
                    onChange={(e) => setVia({ ...via, name: e.target.value })}
                    maxLength={200}
                  />
                </label>
                <label>
                  Their role
                  <input
                    value={via.role}
                    onChange={(e) => setVia({ ...via, role: e.target.value })}
                    maxLength={200}
                    placeholder="e.g. Sending organization"
                  />
                </label>
                <PhoneField
                  label="Their phone"
                  inputMode="tel"
                  value={via.phone}
                  onChange={(e) => setVia({ ...via, phone: e.target.value })}
                  maxLength={100}
                />
                <label>
                  Their email
                  <EmailInput
                    value={via.email}
                    onChange={(e) => setVia({ ...via, email: e.target.value })}
                    maxLength={200}
                  />
                </label>
              </div>
            )}

            {level !== "normal" && (
              <label style={{ marginTop: "0.5rem" }}>
                Guidelines (words to avoid, how to word things)
                <textarea
                  rows={3}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={2000}
                />
              </label>
            )}
          </fieldset>
        )}

        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.6rem 0.8rem" }}>
          <legend>Not this season</legend>
          <label>
            Don't call them quiet until (optional)
            <input type="date" value={snooze} onChange={(e) => setSnooze(e.target.value)} />
          </label>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.4rem 0 0" }}>
            For a partner who is in a busy or private season. Until that day they are left out of "quiet" on
            My partners and the bell. A follow-up date you set on purpose still shows. Leave it blank to clear
            it.
          </p>
        </fieldset>

        {error && (
          <p className="form-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <div className="table-actions">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
