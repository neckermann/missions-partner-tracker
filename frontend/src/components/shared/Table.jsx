import React, { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "../../utils/format.js";

// Generic resource table, the sibling of FilterBar.jsx.
// Column: `{ key, label, type?, align?, render?(row), stopRowClick?, sortable?, sortBy?(row) }`.
// `type` picks a default formatter ("date"/"currency", else raw); `render` overrides it and gets
// the whole row. Currency/number right-align by default; `align` overrides.
// `stopRowClick` keeps a cell's own link/control from also triggering `onRowClick`.
// `renderActions(row)` appends a header-less actions column.
// `expandedRowId` + `renderExpanded(row)` render an inline edit row (colSpan'd) under a row.
// `rowAttrs(row)` spreads attributes onto each <tr> (e.g. data-partner-id for e2e locators).
// `sortable` makes a header clickable: asc, desc, back to asc, never "unsorted", because the
// caller's own row order is a deliberate default. Sort state lives here.
function alignClass(column) {
  if (column.align) return column.align === "right" ? "num" : undefined;
  return column.type === "currency" || column.type === "number" ? "num" : undefined;
}

// A real icon, not a glyph (⇅/▲/▼ render inconsistently across fonts). `direction` is "asc"/"desc"
// for the active column, null otherwise. currentColor: the <th> CSS sets the color per state.
function SortIcon({ direction }) {
  if (direction === "asc") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 2.5 L8.5 7 L1.5 7 Z" fill="currentColor" />
      </svg>
    );
  }
  if (direction === "desc") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 7.5 L1.5 3 L8.5 3 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 1 L7.5 4 L2.5 4 Z" fill="currentColor" />
      <path d="M5 9 L2.5 6 L7.5 6 Z" fill="currentColor" />
    </svg>
  );
}

function defaultCell(column, row) {
  const value = row[column.key];
  if (value === null || value === undefined || value === "") return "—";
  switch (column.type) {
    case "currency":
      return formatCurrency(value, { fallback: "—" });
    case "date":
      return formatDate(value, { fallback: "—" });
    default:
      return String(value);
  }
}

// A sort key, not a display value: dates/numbers compare numerically whatever `render` shows,
// booleans sort false first, anything else is a case-insensitive string compare. A column computed
// from something other than row[key] supplies its own `sortBy(row)`.
function sortValue(column, row) {
  if (column.sortBy) return column.sortBy(row) ?? null;
  const value = row[column.key];
  if (value === null || value === undefined || value === "") return null;
  if (column.type === "date") return new Date(value).getTime();
  if (column.type === "currency" || column.type === "number") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value).toLowerCase();
}

export default function Table({
  columns,
  rows,
  rowKey = (row) => row.id,
  onRowClick,
  isRowClickable,
  renderActions,
  expandedRowId,
  renderExpanded,
  rowAttrs,
  emptyMessage = "Nothing to show.",
  className = "admin-table",
  style,
}) {
  const colSpan = columns.length + (renderActions ? 1 : 0);
  const [sort, setSort] = useState(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    const dir = sort.direction === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = sortValue(column, a);
      const bv = sortValue(column, b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [rows, sort, columns]);

  function toggleSort(column) {
    if (!column.sortable) return;
    setSort((s) => {
      if (!s || s.key !== column.key) return { key: column.key, direction: "asc" };
      return { key: column.key, direction: s.direction === "asc" ? "desc" : "asc" };
    });
  }

  // Always wrapped in .table-scroll (index.css) so a wide table scrolls within its own box instead of
  // widening the page.
  return (
    <div className="table-scroll" style={style}>
      <table className={className}>
        <thead>
          <tr>
            {columns.map((c) => {
              const sorted = c.sortable && sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  className={[alignClass(c), c.sortable && "sortable", sorted && "sorted"]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={c.sortable ? () => toggleSort(c) : undefined}
                  aria-sort={sorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.sortable ? (
                    <span className="th-inner">
                      <span>{c.label}</span>
                      <span className="sort-indicator">
                        <SortIcon direction={sorted ? sort.direction : null} />
                      </span>
                    </span>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
            {renderActions && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const key = rowKey(row);
            const clickable = onRowClick && (!isRowClickable || isRowClickable(row));
            const expanded = expandedRowId != null && key === expandedRowId;
            return (
              <React.Fragment key={key}>
                <tr
                  onClick={clickable ? () => onRowClick(row) : undefined}
                  style={clickable ? { cursor: "pointer" } : undefined}
                  {...(rowAttrs ? rowAttrs(row) : null)}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={alignClass(c)}
                      onClick={c.stopRowClick ? (e) => e.stopPropagation() : undefined}
                    >
                      {c.render ? c.render(row) : defaultCell(c, row)}
                    </td>
                  ))}
                  {renderActions && (
                    <td className="table-actions" onClick={(e) => e.stopPropagation()}>
                      {renderActions(row)}
                    </td>
                  )}
                </tr>
                {expanded && renderExpanded && (
                  <tr>
                    <td colSpan={colSpan}>{renderExpanded(row)}</td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan || 1} style={{ color: "var(--muted)" }}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
