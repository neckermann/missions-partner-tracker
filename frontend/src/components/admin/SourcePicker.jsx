import React from "react";
import { formatDate } from "../../utils/format.js";
import { fileKindLabel } from "../../utils/fileKinds.js";

// Optional "which file did this come from" dropdown for a manually added prayer request or need,
// the explicit counterpart to the automatic link a scan suggestion gets (see SourceLink.jsx).
// `files` is what the caller already loaded for the partner; renders nothing if there are none.
export default function SourcePicker({ files, sourceFileId, onChange }) {
  if (!files?.length) return null;

  return (
    <label>
      Source (optional)
      <select value={sourceFileId || ""} onChange={(e) => onChange({ sourceFileId: e.target.value || null })}>
        <option value="">None</option>
        {files.map((f) => (
          <option key={f.id} value={f.id}>
            {f.title ? `${f.title} — ${f.fileName}` : f.fileName} · {fileKindLabel(f)} (
            {formatDate(f.receivedDate)})
          </option>
        ))}
      </select>
    </label>
  );
}
