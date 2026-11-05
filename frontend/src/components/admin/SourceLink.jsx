import React from "react";
import { formatDate } from "../../utils/format.js";

// "From: <title>, <date>" on a prayer request/one-time need card, linking
// back to the file it came from (see sourceFileId's comment in
// schema.prisma). Set either automatically when an AI-scanned suggestion
// is accepted, or by hand via SourcePicker.jsx on the Add/Edit form --
// this component renders identically either way, and renders nothing when
// no source file is set (the normal case for a request/need with no known
// source).
export default function SourceLink({ sourceFile }) {
  if (!sourceFile) return null;

  return (
    <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
      From:{" "}
      <a href={`/api/partner-files/${sourceFile.id}/download`} target="_blank" rel="noreferrer">
        {sourceFile.title || sourceFile.fileName}, {formatDate(sourceFile.receivedDate)}
      </a>
    </div>
  );
}
