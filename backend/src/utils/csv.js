// CSV serialization for the Reports section.
//
// Deliberately small and hand-written rather than a dependency: the whole
// job is quoting, and the rules are short enough to state in one function
// and test exhaustively. A library would be more code to audit than this.
//
// The format is RFC 4180: fields containing a comma, a double quote, or a
// line break are wrapped in double quotes, and a double quote inside such a
// field is escaped by doubling it.

// Values that should read as empty rather than as the word "null".
function cell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Date-only columns come back from Prisma as UTC midnight. Slicing the
    // ISO string keeps the calendar date the database meant; constructing a
    // local Date first would shift it a day west of UTC. Same reasoning as
    // toDateInputValue in frontend/src/utils/format.js.
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function escapeField(value) {
  const text = cell(value);
  // \r matters on its own: Excel treats a bare CR inside an unquoted field
  // as a row break.
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// A UTF-8 byte-order mark.
//
// Excel on Windows still guesses the encoding of a .csv from its bytes, and
// without this it reads UTF-8 as the system code page -- so a partner in
// "Côte d'Ivoire" or a name like "Muñoz" arrives mangled. Every other
// consumer (Sheets, Numbers, pandas, a text editor) skips a BOM silently,
// so this costs nothing and fixes the one tool a church treasurer actually
// opens the file in.
const BOM = "﻿";

// `columns` is the report's own column list -- [{ key, label }] -- so the
// header row and the body can't drift apart, and the CSV column order is
// the same as the table on screen.
function toCsv(rows, columns, { bom = true } = {}) {
  const header = columns.map((c) => escapeField(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeField(row[c.key])).join(","));
  // CRLF per RFC 4180, and what Excel expects.
  return (bom ? BOM : "") + [header, ...body].join("\r\n") + "\r\n";
}

// Turns a report label into something safe to put in a Content-Disposition
// filename and sane to find later in a downloads folder.
function csvFilename(label, { now = new Date() } = {}) {
  const slug =
    String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "report";
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `${slug}-${stamp}.csv`;
}

module.exports = { toCsv, csvFilename, escapeField };
