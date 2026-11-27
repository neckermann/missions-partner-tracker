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

const emptyParticipant = { firstName: "", lastName: "", role: "", phone: "", email: "" };

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

// The dates/type/description/notes/album/participants field set shared by PartnerTripSection.jsx
// and AdminTrips.jsx's ExistingTripsTab. Form-grid body plus participants editor; `partnerPicker`
// is injected only where a partner picker is needed. No create/edit difference, so no `mode`.
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
          <button
            type="button"
            className="btn-remove"
            onClick={() => removeParticipant(i)}
            title="Remove this participant"
            aria-label={`Remove ${[p.firstName, p.lastName].filter(Boolean).join(" ") || "this participant"}`}
          >
            Remove
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
        </div>
      ))}
      <button type="button" className="btn secondary small" onClick={addParticipant}>
        + Add Participant
      </button>
    </>
  );
}
