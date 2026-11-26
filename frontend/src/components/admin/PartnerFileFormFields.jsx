import React from "react";
import { FILE_KINDS } from "../../utils/fileKinds.js";

// The Kind/Title/Received Date/Notes fields shared by AdminPartnerFiles.jsx's add form and inline
// edit row and the Partner Detail quick-upload modal. The file input and Partner picker are
// injected as slots so each caller places them.
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
