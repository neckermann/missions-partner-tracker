import React, { useEffect, useMemo, useState } from "react";
import { listReports, runReport, reportCsvUrl } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { formatCurrency, formatDate, formatMonthDay } from "../utils/format.js";

// The Reports shell.
//
// Everything here is generic: the picker, the filter form, the table, and
// the two outputs. What a report *is* lives on the server
// (backend/src/reports/), which declares its filter fields, its columns and
// a plain query. Adding a report should mean adding a module there, never
// editing this file.
//
// Reports are read-only on purpose. The resource pages keep doing the
// editing -- you answer a prayer request on /admin/prayer-requests and
// export one from here. Keeping that line is what stops this growing into a
// second, half-working copy of every list page.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Defaults for a report's filters, before the user touches anything.
//
// The month default is the browser's current month, which is the only
// correct source: no church timezone is stored anywhere, so the server
// cannot know what month it is where the person is standing.
function initialValues(report, now = new Date()) {
  const values = {};
  for (const field of report.fields || []) {
    if (field.type === "month") {
      values[field.name] = now.getMonth() + 1;
      values.year = now.getFullYear();
    } else if (field.type === "checkbox") {
      values[field.name] = false;
    } else if (field.type === "select") {
      values[field.name] = field.options?.[0]?.value ?? "";
    } else {
      values[field.name] = "";
    }
  }
  return values;
}

// Blank filters are omitted rather than sent empty: `from=` would reach the
// server as "" and z.coerce.date() rejects that with a 400, which is the
// same sharp edge that bit the partner date fields.
function toParams(values) {
  const params = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value === null || value === undefined) continue;
    if (value === false) continue;
    params[key] = value;
  }
  return params;
}

function Cell({ column, row }) {
  const value = row[column.key];
  if (value === null || value === undefined || value === "") return <>—</>;

  switch (column.type) {
    case "currency":
      return <>{formatCurrency(value, { fallback: "—" })}</>;
    case "date":
      return <>{formatDate(value, { fallback: "—" })}</>;
    case "monthDay":
      return <>{formatMonthDay(row.month, row.day) ?? "—"}</>;
    default:
      return <>{String(value)}</>;
  }
}

export default function AdminReports() {
  const { churchName } = useSettings();
  const [reports, setReports] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [values, setValues] = useState({});
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  // Separate from `error` for the report run: a failure to load the list of
  // reports at all is a different problem from one report failing, and
  // conflating them is how you get "no reports exist" when the server is
  // simply down.
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);

  const selected = useMemo(
    () => (reports || []).find((r) => r.id === selectedId) || null,
    [reports, selectedId]
  );

  useEffect(() => {
    listReports()
      .then((data) => {
        setReports(data);
        if (data.length) {
          setSelectedId(data[0].id);
          setValues(initialValues(data[0]));
        }
      })
      .catch((err) => setLoadError(err.response?.data?.error || "Couldn't load the list of reports."));
  }, []);

  function selectReport(id) {
    const report = (reports || []).find((r) => r.id === id);
    if (!report) return;
    setSelectedId(id);
    setValues(initialValues(report));
    // The previous report's rows are meaningless under a different report's
    // columns, and leaving them on screen while the new one loads reads as
    // though they belong to it.
    setResult(null);
    setError(null);
  }

  function setValue(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function run(event) {
    event?.preventDefault();
    if (!selected) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await runReport(selected.id, toParams(values)));
    } catch (err) {
      setResult(null);
      setError(err.response?.data?.error || "Couldn't run that report.");
    } finally {
      setRunning(false);
    }
  }

  function downloadCsv() {
    // A plain same-origin navigation so the browser handles the file and the
    // session cookie rides along -- the same approach as the document and
    // newsletter downloads.
    window.open(reportCsvUrl(selected.id, toParams(values)), "_blank");
  }

  if (loadError) {
    return (
      <div className="admin-shell">
        <h2>Reports</h2>
        <p className="form-error" role="alert">
          {loadError}
        </p>
        <button type="button" className="btn secondary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  if (!reports) return <p className="admin-shell">Loading…</p>;

  return (
    <div className="admin-shell">
      <h2>Reports</h2>
      <p className="no-print" style={{ color: "#555" }}>
        Read-only views over data already in the tracker. Download as CSV for a spreadsheet, or print to share
        on paper.
      </p>

      <div className="admin-section no-print">
        <label>
          Report
          <select value={selectedId || ""} onChange={(e) => selectReport(e.target.value)}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {selected?.description && <p style={{ color: "#555" }}>{selected.description}</p>}

        {selected && (
          <form onSubmit={run} className="form-grid" style={{ marginTop: "1rem" }}>
            {(selected.fields || []).map((field) => (
              <label key={field.name}>
                {field.label}
                {field.type === "month" && (
                  <select
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValue(field.name, Number(e.target.value))}
                  >
                    {MONTHS.map((label, i) => (
                      <option key={label} value={i + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                {field.type === "select" && (
                  <select
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValue(field.name, e.target.value)}
                  >
                    {(field.options || []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {field.type === "date" && (
                  <input
                    type="date"
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValue(field.name, e.target.value)}
                  />
                )}
                {field.type === "checkbox" && (
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.name])}
                    onChange={(e) => setValue(field.name, e.target.checked)}
                  />
                )}
              </label>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="btn" disabled={running}>
                {running ? "Running…" : "Run report"}
              </button>
            </div>
          </form>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="admin-section report-output">
          <div className="report-header">
            <div>
              <h3>{result.label}</h3>
              {/* Printed so a PDF on someone's desk says what it is and when
                  it was true -- a report with no date on it is a liability at
                  a meeting six weeks later. */}
              <p className="report-meta">
                {churchName ? `${churchName} · ` : ""}
                {result.rows.length} {result.rows.length === 1 ? "row" : "rows"} · generated{" "}
                {formatDate(result.generatedAt, { fallback: "" })}
              </p>
            </div>
            <div className="no-print report-actions">
              <button type="button" className="btn secondary" onClick={downloadCsv}>
                Download CSV
              </button>
              <button type="button" className="btn secondary" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>

          {result.rows.length === 0 ? (
            <p>Nothing matched those filters.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={row.id || i}>
                      {result.columns.map((c) => (
                        <td key={c.key}>
                          <Cell column={c} row={row} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
