import React, { useCallback, useEffect, useState } from "react";
import { fetchAuditLog, fetchAuditMeta, setAuditRetention, auditExportUrl } from "../api/client.js";
import SettingsPageHeader from "../components/admin/SettingsPageHeader.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import Field from "../components/admin/Field.jsx";

// The activity log (#341): who did what, when, for the sensitive actions --
// sign-ins, role and access changes, settings changes, deletes, backups, views
// of restricted partners. Admin only. Events are kept for the retention window
// below and then pruned; who last edited a record is kept separately, on the
// record itself, and never expires.
const EMPTY = { q: "", category: "", from: "", to: "" };

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

export default function AdminSettingsActivity() {
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [rows, setRows] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState(null);

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
      .catch(() => !cancelled && setError("Couldn't load the activity log."));
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

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const apply = (e) => {
    e.preventDefault();
    setApplied(filters);
  };
  const clear = () => {
    setFilters(EMPTY);
    setApplied(EMPTY);
  };
  const filtered = Object.values(applied).some(Boolean);

  return (
    <div className="admin-shell">
      <SettingsPageHeader
        title="Activity"
        actions={
          <a className="btn secondary" href={auditExportUrl(applied)}>
            Export CSV
          </a>
        }
      />
      <p style={{ color: "#555" }}>
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
              <p style={{ color: "#555", marginTop: "0.5rem" }}>
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
        <form
          onSubmit={apply}
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            alignItems: "flex-end",
            marginBottom: "1rem",
          }}
        >
          <label style={{ flex: "2 1 14rem" }}>
            Search
            <input
              type="search"
              value={filters.q}
              onChange={set("q")}
              placeholder="Name, email, record or IP address"
            />
          </label>
          <label style={{ flex: "1 1 10rem" }}>
            What
            <select value={filters.category} onChange={set("category")}>
              <option value="">Everything</option>
              {(meta?.categories || []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: "1 1 9rem" }}>
            From
            <input type="date" value={filters.from} onChange={set("from")} />
          </label>
          <label style={{ flex: "1 1 9rem" }}>
            To
            <input type="date" value={filters.to} onChange={set("to")} />
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="btn">
              Filter
            </button>
            {filtered && (
              <button type="button" className="btn secondary" onClick={clear}>
                Clear
              </button>
            )}
          </div>
        </form>

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
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>About</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <When iso={r.createdAt} />
                    </td>
                    <td>
                      <Person p={r.actor} />
                    </td>
                    <td>{r.label}</td>
                    <td>
                      {r.target ? <Person p={r.target} /> : null}
                      {r.entity && (
                        <div style={r.target ? { color: "var(--muted)", fontSize: "0.8rem" } : undefined}>
                          {r.entity.label || r.entity.type}
                        </div>
                      )}
                      {!r.target && !r.entity && <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ minWidth: "13rem" }}>
                      {r.summary}
                      {r.ip && <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>from {r.ip}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
