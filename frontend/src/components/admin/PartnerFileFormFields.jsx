import React from "react";
import { FILE_KINDS } from "../../utils/fileKinds.js";

// The Kind/Title/Received Date/Notes field set shared by AdminPartnerFiles.jsx's
// add form and its own inline edit row, and now also the Partner Detail
// quick-upload modal. Deliberately doesn't own the file input itself
// (only the add form has one, and it needs its own onChange producing a
// File object rather than form state) or the Partner picker (only the
// consolidated page's add form needs one -- the embedded contexts already
// have a fixed partnerId) -- both are injected as slots so each caller
// places them exactly where it wants.
export default function PartnerFileFormFields({ form, setForm, partnerPicker, fileInput }) {
  return (
    <div className="form-grid">
      {partnerPicker}
      {fileInput}
      <label>
        Kind
        <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
          {FILE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {form.kind === "other" && (
        <label>
          Kind label
          <input
            value={form.customKind}
            onChange={(e) => setForm((f) => ({ ...f, customKind: e.target.value }))}
            placeholder="e.g. Background Check"
            required
          />
        </label>
      )}
      <label>
        Title (optional)
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="e.g. Summer 2026 Update"
        />
      </label>
      <label>
        Received Date
        <input
          type="date"
          value={form.receivedDate}
          onChange={(e) => setForm((f) => ({ ...f, receivedDate: e.target.value }))}
          required
        />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Notes
        <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </label>
    </div>
  );
}
