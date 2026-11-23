import React from "react";
import PresetOrCustomSelect from "./PresetOrCustomSelect.jsx";
import AlbumLinkField from "./AlbumLinkField.jsx";

export const TRIP_TYPE_PRESETS = [
  "Construction",
  "Medical/Dental",
  "VBS/Children's Ministry",
  "Evangelism/Outreach",
  "Teaching/Discipleship",
  "Prayer",
  "General Labor",
  "Sports Ministry",
  "Music/Worship",
  "Administrative/Support",
];

const emptyParticipant = { firstName: "", lastName: "", role: "", isLeader: false, phone: "", email: "" };

export const emptyTripForm = {
  partnerId: "",
  startDate: "",
  endDate: "",
  type: "",
  description: "",
  notes: "",
  albumProvider: null,
  albumUrl: null,
  participants: [],
};

export function cleanTripParticipants(participants) {
  return (participants || [])
    .map((p) => ({ ...p, firstName: p.firstName.trim() }))
    .filter((p) => p.firstName);
}

// Phase 3b of the UX-rebuild plan: the dates/type/description/notes/album/
// participants field set duplicated between PartnerTripSection.jsx
// (embedded on Partner Detail, fixed partnerId) and AdminTrips.jsx's
// ExistingTripsTab (consolidated -- both its "log a completed trip" add
// form and its inline edit-row shared this same shape, just across two
// separate state objects). Same pattern as SupportNeedFormFields.jsx:
// renders only the form-grid body plus the participants editor,
// `partnerPicker` is injected by the caller only where a partner picker
// is actually needed (the consolidated page's create flow) -- there's no
// create/edit field difference here, unlike SupportNeedFormFields, so no
// `mode` prop.
export default function TripFormFields({ form, setForm, partnerPicker }) {
  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  function addParticipant() {
    setForm((f) => ({ ...f, participants: [...f.participants, { ...emptyParticipant }] }));
  }
  function updateParticipant(index, field, value) {
    setForm((f) => {
      const next = [...f.participants];
      next[index] = { ...next[index], [field]: value };
      return { ...f, participants: next };
    });
  }
  function removeParticipant(index) {
    setForm((f) => ({ ...f, participants: f.participants.filter((_, i) => i !== index) }));
  }

  return (
    <>
      <div className="form-grid">
        {partnerPicker}
        <label>
          Start Date
          <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </label>
        <label>
          End Date
          <input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </label>
        <label>
          Trip Type
          <PresetOrCustomSelect
            value={form.type}
            onChange={(v) => set("type", v)}
            presets={TRIP_TYPE_PRESETS}
            placeholder="e.g. Photography"
          />
        </label>
      </div>
      <label style={{ marginTop: "0.75rem" }}>
        Description (what the team did)
        <textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
      </label>
      <label style={{ marginTop: "0.75rem" }}>
        Notes
        <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <label style={{ marginTop: "0.75rem" }}>
        Photo/Video Album
        <AlbumLinkField
          provider={form.albumProvider}
          url={form.albumUrl}
          onChange={(provider, url) => setForm((f) => ({ ...f, albumProvider: provider, albumUrl: url }))}
        />
      </label>

      <h4 style={{ marginTop: "1rem" }}>Participants</h4>
      {form.participants.map((p, i) => (
        <div className="repeatable-row" key={i} style={{ background: "white" }}>
          <button type="button" className="btn-remove" onClick={() => removeParticipant(i)} title="Remove">
            ✕
          </button>
          <div className="form-grid">
            <label>
              First Name
              <input
                value={p.firstName}
                onChange={(e) => updateParticipant(i, "firstName", e.target.value)}
              />
            </label>
            <label>
              Last Name
              <input
                value={p.lastName || ""}
                onChange={(e) => updateParticipant(i, "lastName", e.target.value)}
              />
            </label>
            <label>
              Role
              <input
                value={p.role || ""}
                onChange={(e) => updateParticipant(i, "role", e.target.value)}
                placeholder="e.g. Construction"
              />
            </label>
            <label>
              Phone
              <input value={p.phone || ""} onChange={(e) => updateParticipant(i, "phone", e.target.value)} />
            </label>
            <label>
              Email
              <input value={p.email || ""} onChange={(e) => updateParticipant(i, "email", e.target.value)} />
            </label>
          </div>
          <div className="admin-checkbox-row" style={{ marginTop: "0.5rem" }}>
            <label>
              <input
                type="checkbox"
                checked={!!p.isLeader}
                onChange={(e) => updateParticipant(i, "isLeader", e.target.checked)}
              />
              Team Leader
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="btn secondary small" onClick={addParticipant}>
        + Add Participant
      </button>
    </>
  );
}
