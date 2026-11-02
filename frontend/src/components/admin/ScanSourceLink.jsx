import React from "react";
import { formatDate } from "../../utils/format.js";

// "From: <title>, <date>" on a prayer request/one-time need card, linking
// back to the newsletter or document it was scanned from (see
// sourceNewsletterId/sourceDocumentId's comment in schema.prisma). At most
// one of sourceNewsletter/sourceDocument is ever set; renders nothing for a
// request/need added by hand, which is the normal case.
export default function ScanSourceLink({ sourceNewsletter, sourceDocument }) {
  const source = sourceNewsletter
    ? { ...sourceNewsletter, href: `/api/newsletters/${sourceNewsletter.id}/download` }
    : sourceDocument
      ? { ...sourceDocument, href: `/api/documents/${sourceDocument.id}/download` }
      : null;
  if (!source) return null;

  return (
    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
      From:{" "}
      <a href={source.href} target="_blank" rel="noreferrer">
        {source.title || source.fileName}, {formatDate(source.receivedDate)}
      </a>
    </div>
  );
}
