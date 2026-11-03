import React from "react";
import { formatDate } from "../../utils/format.js";
import { documentCategoryLabel } from "../../utils/documentCategories.js";

// Optional "which file did this come from" dropdown for a manually-added
// prayer request or one-time need -- the explicit counterpart to the
// automatic link a "Scan for requests" suggestion gets (see
// SourceLink.jsx, which renders identically either way), for the case
// where someone read a newsletter themselves and typed the request in
// rather than running the scan.
// newsletters/documents are whatever the caller has already loaded for the
// relevant partner; at most one of sourceNewsletterId/sourceDocumentId is
// ever set, matching that column pair in schema.prisma. Renders nothing if
// the partner has no files on file yet -- nothing to pick from.
export default function SourcePicker({
  newsletters,
  documents,
  sourceNewsletterId,
  sourceDocumentId,
  onChange,
}) {
  if (!newsletters?.length && !documents?.length) return null;

  const value = sourceNewsletterId
    ? `newsletter:${sourceNewsletterId}`
    : sourceDocumentId
      ? `document:${sourceDocumentId}`
      : "";

  function handleChange(e) {
    const v = e.target.value;
    if (v.startsWith("newsletter:")) onChange({ sourceNewsletterId: v.slice(11), sourceDocumentId: null });
    else if (v.startsWith("document:")) onChange({ sourceNewsletterId: null, sourceDocumentId: v.slice(9) });
    else onChange({ sourceNewsletterId: null, sourceDocumentId: null });
  }

  return (
    <label>
      Source (optional)
      <select value={value} onChange={handleChange}>
        <option value="">None</option>
        {newsletters?.length > 0 && (
          <optgroup label="Newsletters">
            {newsletters.map((n) => (
              <option key={n.id} value={`newsletter:${n.id}`}>
                {n.title ? `${n.title} — ${n.fileName}` : n.fileName} ({formatDate(n.receivedDate)})
              </option>
            ))}
          </optgroup>
        )}
        {documents?.length > 0 && (
          <optgroup label="Documents">
            {documents.map((d) => (
              <option key={d.id} value={`document:${d.id}`}>
                {d.title ? `${d.title} — ${d.fileName}` : d.fileName} · {documentCategoryLabel(d)} (
                {formatDate(d.receivedDate)})
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
