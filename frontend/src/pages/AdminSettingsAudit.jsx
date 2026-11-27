import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAuditLog, fetchAuditMeta, setAuditRetention, auditExportUrl } from "../api/client.js";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import Field from "../components/admin/Field.jsx";
import FilterBar from "../components/shared/FilterBar.jsx";
import Table from "../components/shared/Table.jsx";
import useFilterState from "../hooks/useFilterState.js";

// The audit log: who did what, when, for sensitive actions (sign-ins, role and access
// changes, settings changes, deletes, backups, views of restricted partners). Admin only.
// Events are pruned after the retention window; who last edited a record is kept on the
// record itself and never expires.
const EMPTY = { search: "", category: "all", from: "", to: "" };

// Date over time, so the column stays narrow and the details have room.
function When({ iso }) {
  const d = new Date(iso);
  return (
    <>
      {d.toLocaleDateString()}
      <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
        {d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </div>
    </>
  );
}

function Person({ p }) {
  if (!p) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <>
      {p.name}
      {p.deleted && <span style={{ color: "var(--muted)" }}> (deleted account)</span>}
      {p.email && p.name !== p.email && (
        <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{p.email}</div>
      )}
    </>
  );
}

export default function AdminSettingsAudit() {
  const [rows, setRows] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState(null);

  const fields = useMemo(
    () => [
      { name: "search", label: "Search name, email, record or IP address", type: "text" },
      {
        name: "category",
        label: "What",
        type: "select",
        options: [
          { value: "all", label: "Everything" },
          ...(meta?.categories || []).map((c) => ({ value: c, label: c })),
        ],
      },
      { name: "from", label: "From", type: "date" },
      { name: "to", label: "To", type: "date" },
    ],
    [meta]
  );
  const { values: filters, setValue: updateFilter, reset: resetFilters } = useFilterState(fields, EMPTY);
  // The log and the CSV export take the filters in their own shape.
  const applied = useMemo(
    () => ({
      q: filters.search || "",
      category: filters.category === "all" ? "" : filters.category,
      from: filters.from || "",
      to: filters.to || "",
    }),
    [filters.search, filters.category, filters.from, filters.to]
  );

  const loadMeta = useCallback(() => fetchAuditMeta().then(setMeta).catch(console.error), []);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchAuditLog(applied)
      .then((d) => {
        if (cancelled) return;
        setRows(d.rows);
        setCursor(d.nextCursor);
        setError("");
      })
      .catch(() => !cancelled && setError("Couldn't load the audit log."));
    return () => {
      cancelled = true;
    };
  }, [applied]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const d = await fetchAuditLog({ ...applied, cursor });
      setRows((r) => [...r, ...d.rows]);
      setCursor(d.nextCursor);
    } catch {
      setError("Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = Object.values(applied).some(Boolean);

  return (
    <div className="admin-shell">
      <SettingsPageHeader
        title="Audit Log"
        actions={
          <a className="btn secondary" href={auditExportUrl(applied)}>
            Export CSV
          </a>
        }
      />
      <p style={{ color: "var(--muted)" }}>
        Who did what, and when, for sign-ins, role and access changes, settings changes, deletes, backups and
        views of restricted partners. Routine edits are not listed; each record shows who last edited it.
      </p>

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Retention</h2>
        <EditableSection
          title="Retention"
          canEdit
          value={{ days: String(meta?.retentionDays ?? 90) }}
          onSave={(draft) => setAuditRetention(Number(draft.days))}
          onSaved={loadMeta}
          view={() => (
            <>
              <Field
                label="Keep entries for"
                value={meta ? `${meta.retentionDays} days` : "Loading…"}
                showEmpty
              />
              <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
                Older entries are deleted each night.
                {meta?.total != null && ` ${meta.total} ${meta.total === 1 ? "entry" : "entries"} held now.`}
              </p>
            </>
          )}
          edit={(d, setD) => (
            <label>
              Keep entries for
              <select value={d.days} onChange={(e) => setD("days", e.target.value)}>
                {(meta?.retentionChoices || [30, 60, 90]).map((n) => (
                  <option key={n} value={n}>
                    {n} days
                  </option>
                ))}
              </select>
            </label>
          )}
        />
      </div>

      <div className="admin-section-group">
        <h2 className="admin-group-heading">Log</h2>
        <FilterBar fields={fields} values={filters} onChange={updateFilter} onReset={resetFilters} />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {rows === null && !error && <p style={{ color: "var(--muted)" }}>Loading…</p>}
        {rows && rows.length === 0 && (
          <p style={{ color: "var(--muted)" }}>
            {filtered ? "Nothing matches those filters." : "Nothing has been recorded yet."}
          </p>
        )}
        {rows && rows.length > 0 && (
          <Table
            rows={rows}
            columns={[
              { key: "createdAt", label: "When", render: (r) => <When iso={r.createdAt} /> },
              { key: "actor", label: "Who", render: (r) => <Person p={r.actor} /> },
              { key: "label", label: "What" },
              {
                key: "about",
                label: "About",
                render: (r) => (
                  <>
                    {r.target ? <Person p={r.target} /> : null}
                    {r.entity && (
                      <div style={r.target ? { color: "var(--muted)", fontSize: "0.8rem" } : undefined}>
                        {r.entity.label || r.entity.type}
                      </div>
                    )}
                    {!r.target && !r.entity && <span style={{ color: "var(--muted)" }}>—</span>}
                  </>
                ),
              },
              {
                key: "summary",
                label: "Details",
                render: (r) => (
                  <div style={{ minWidth: "13rem" }}>
                    {r.summary}
                    {r.ip && <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>from {r.ip}</div>}
                  </div>
                ),
              },
            ]}
          />
        )}
        {cursor && (
          <p>
            <button type="button" className="btn secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
