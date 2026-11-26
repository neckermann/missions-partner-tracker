import React from "react";
import { formatDate } from "../../utils/format.js";

// "From: <title>, <date>" on a prayer request/one-time need card, linking to the file it came from
// (see sourceFileId in schema.prisma). Set by an accepted scan suggestion or by hand via
// SourcePicker.jsx; renders nothing when no source file is set.
export default function SourceLink({ sourceFile }) {
  if (!sourceFile) return null;

  return (
    <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
      From:{" "}
      <a href={`/api/partner-files/${sourceFile.id}/download`} target="_blank" rel="noreferrer">
        {sourceFile.title || sourceFile.fileName}, {formatDate(sourceFile.receivedDate)}
      </a>
    </div>
  );
}
