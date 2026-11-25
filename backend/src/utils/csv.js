// CSV serialization for the Reports section (RFC 4180: fields containing a comma,
// double quote or line break are quoted, with inner quotes doubled). Hand-written
// rather than a dependency: the whole job is quoting, shorter to audit than a library.

// Values that should read as empty rather than as the word "null".
function cell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Date-only columns are UTC midnight; slicing the ISO string keeps the
    // intended calendar date (a local Date would shift it a day west of UTC).
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

// A field starting with one of these is read as a formula by Excel/Sheets/
// LibreOffice (CSV injection, CWE-1236). Report rows carry free text an
// editor-level account controls, opened later by an admin in a spreadsheet, so
// this crosses a privilege boundary. A leading quote forces text.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function neutralizeFormula(text) {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

function escapeField(value) {
  const text = neutralizeFormula(cell(value));
  // \r matters on its own: Excel treats a bare CR inside an unquoted field as a row break.
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// A UTF-8 byte-order mark: without it Excel on Windows reads UTF-8 as the system
// code page and mangles names like "Muñoz". Other consumers skip a BOM silently.
const BOM = "﻿";

// `columns` is the report's [{ key, label }] list, so header and body can't drift
// apart and CSV order matches the on-screen table.
function toCsv(rows, columns, { bom = true } = {}) {
  const header = columns.map((c) => escapeField(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeField(row[c.key])).join(","));
  // CRLF per RFC 4180, and what Excel expects.
  return (bom ? BOM : "") + [header, ...body].join("\r\n") + "\r\n";
}

// Turns a report label into a safe Content-Disposition filename.
//
// UTC getters on purpose: routes/reports.js passes the request's "today" (the
// browser's calendar day as UTC midnight), and local getters would misread it in
// the server's zone. UTC also stamps a plain `new Date()` deterministically.
function csvFilename(label, { now = new Date() } = {}) {
  const slug =
    String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "report";
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return `${slug}-${stamp}.csv`;
}

module.exports = { toCsv, csvFilename, escapeField };
