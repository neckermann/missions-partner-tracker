import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { listReports, runReport, reportCsvUrl } from "../api/client.js";
import { useSettings } from "../context/SettingsContext.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import Table from "../components/shared/Table.jsx";
import ReportBarChart from "../components/shared/ReportBarChart.jsx";
import SavedViewsBar from "../components/admin/SavedViewsBar.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";
import useFilterState from "../hooks/useFilterState.js";
import { formatCurrency, formatDate, formatDateLong, todayInputValue } from "../utils/format.js";

// One report. Generic on purpose: the filter bar, summary, table and the
// two outputs are all driven by the server's description of the report.
// Filters live in the URL (useFilterState) so a filtered view can be
// bookmarked or shared. Print reuses the existing report letterhead rules
// in index.css, so a fork's logo and brand color come through unchanged.
function summaryValue(item) {
  if (item.type === "currency" && typeof item.value === "number") return formatCurrency(item.value);
  return item.value;
}

export default function AdminReport() {
  const { reportId } = useParams();
  const { churchName, logo } = useSettings();
  const { isAdmin } = useCurrentUser();
  const [meta, setMeta] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const today = todayInputValue();

  useEffect(() => {
    let cancelled = false;
    listReports()
      .then((c) => {
        if (cancelled) return;
        const found = c.reports.find((r) => r.id === reportId);
        if (found) setMeta(found);
        else setError("That report isn't available.");
      })
      .catch(() => !cancelled && setError("Couldn't load the report."));
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const fields = useMemo(() => meta?.fields || [], [meta]);
  const defaults = useMemo(() => {
    const d = {};
    for (const f of fields) {
      if (f.type === "select") d[f.name] = f.options?.[0]?.value ?? "all";
      else if (f.type === "checkbox") d[f.name] = false;
      else d[f.name] = "";
    }
    return d;
  }, [fields]);
  const { values, setValue, reset } = useFilterState(fields, defaults);
  const valuesKey = JSON.stringify(values);

  // Checkbox defaults of `true` on the server (e.g. "only partners with
  // gaps") are sent explicitly so unchecking one actually reaches it.
  const queryParams = useMemo(() => {
    const q = { today };
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === "checkbox") q[f.name] = Boolean(v);
      else if (v !== "" && v !== undefined) q[f.name] = v;
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey, fields, today]);

  useEffect(() => {
    if (!meta) return undefined;
    let cancelled = false;
    setLoading(true);
    runReport(reportId, queryParams)
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.error;
        setError(typeof msg === "string" ? msg : "Couldn't run the report.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [meta, reportId, queryParams]);

  const columns = useMemo(
    () => (result?.columns || meta?.columns || []).map((c) => ({ ...c, sortable: true })),
    [result, meta]
  );

  return (
    <div className="admin-shell">
      <Breadcrumb items={[{ label: "Reports", to: "/admin/reports" }, { label: meta?.label || "Report" }]} />
      <h2>{meta?.label || "Report"}</h2>
      {meta?.question && <p style={{ color: "#666", marginTop: 0 }}>{meta.question}</p>}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {meta && (
        <div className="admin-section no-print">
          <FilterBar fields={fields} values={values} onChange={setValue} onReset={reset} />
        </div>
      )}

      {meta && (
        <SavedViewsBar
          reportId={reportId}
          queryValues={Object.fromEntries(Object.entries(queryParams).filter(([k]) => k !== "today"))}
          isAdmin={isAdmin}
          onApply={(params) => {
            // Reset every field, then lay the saved values over it.
            fields.forEach((f) => setValue(f.name, params[f.name] ?? defaults[f.name]));
          }}
        />
      )}

      {result && (
        <div className="admin-section report-output">
          <div className="report-letterhead" aria-hidden="true">
            {logo?.url && <img src={logo.url} alt="" className="report-letterhead-logo" />}
            <div className="report-letterhead-text">
              {churchName && <div className="report-letterhead-church">{churchName}</div>}
              <div className="report-letterhead-title">{result.label}</div>
            </div>
            <div className="report-letterhead-meta">
              <div>{formatDateLong(today, { fallback: "" })}</div>
              <div>
                {result.rows.length} {result.rows.length === 1 ? "row" : "rows"}
              </div>
            </div>
          </div>

          <div className="report-header">
            <p className="report-meta">
              {result.rows.length} {result.rows.length === 1 ? "row" : "rows"} · as of {formatDate(today)}
              {loading ? " · updating…" : ""}
            </p>
            <div className="no-print report-actions">
              <a className="btn secondary" href={reportCsvUrl(reportId, queryParams)}>
                Download CSV
              </a>
              <button type="button" className="btn secondary" onClick={() => window.print()}>
                Print / save as PDF
              </button>
            </div>
          </div>

          {result.summary.length > 0 && (
            <dl className="report-summary">
              {result.summary.map((s) => {
                if (!s.filter) {
                  return (
                    <div key={s.label} className="report-summary-item">
                      <dt>{s.label}</dt>
                      <dd>{summaryValue(s)}</dd>
                    </div>
                  );
                }
                const active = Object.entries(s.filter).every(([k, v]) => String(values[k]) === String(v));
                return (
                  <div key={s.label} className="no-print">
                    <dt className="sr-only">{s.label}</dt>
                    <dd style={{ margin: 0 }}>
                      <button
                        type="button"
                        className="report-summary-item"
                        aria-pressed={active}
                        title="Show only these rows"
                        onClick={() => {
                          // Clicking an active tile clears it back to the defaults.
                          Object.entries(s.filter).forEach(([k, v]) => setValue(k, active ? defaults[k] : v));
                        }}
                      >
                        <span className="report-summary-label">{s.label}</span>
                        <span className="report-summary-value">{summaryValue(s)}</span>
                      </button>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          <ReportBarChart chart={result.chart} rows={result.rows} />

          <Table columns={columns} rows={result.rows} emptyMessage="Nothing matched those filters." />

          {result.notes.map((n) => (
            <p key={n} className="report-meta">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
