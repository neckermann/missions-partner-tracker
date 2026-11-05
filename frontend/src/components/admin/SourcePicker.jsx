import React from "react";
import { formatDate } from "../../utils/format.js";
import { fileKindLabel } from "../../utils/fileKinds.js";

// Optional "which file did this come from" dropdown for a manually-added
// prayer request or one-time need -- the explicit counterpart to the
// automatic link a "Scan for requests" suggestion gets (see
// SourceLink.jsx, which renders identically either way), for the case
// where someone read a file themselves and typed the request in rather
// than running the scan.
// `files` is whatever the caller has already loaded for the relevant
// partner. Renders nothing if the partner has no files on file yet --
// nothing to pick from.
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
