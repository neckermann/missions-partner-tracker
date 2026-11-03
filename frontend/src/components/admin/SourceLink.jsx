import React from "react";
import { formatDate } from "../../utils/format.js";

// "From: <title>, <date>" on a prayer request/one-time need card, linking
// back to the newsletter or document it came from (see
// sourceNewsletterId/sourceDocumentId's comment in schema.prisma). Set
// either automatically when an AI-scanned suggestion is accepted, or by
// hand via SourcePicker.jsx on the Add/Edit form -- this component renders
// identically either way, and renders nothing when neither is set (the
// normal case for a request/need with no known source document). At most
// one of sourceNewsletter/sourceDocument is ever set.
export default function SourceLink({ sourceNewsletter, sourceDocument }) {
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
