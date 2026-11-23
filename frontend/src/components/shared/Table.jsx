import React, { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "../../utils/format.js";

// Generic resource-agnostic table, resource-agnostic sibling of
// FilterBar.jsx -- lifted out of AdminReports.jsx's Cell/alignClass
// helpers plus the admin-table markup every resource list page
// (AdminTrips.jsx, AdminPartners.jsx, ...) had been rebuilding by hand.
//
// A column is `{ key, label, type?, align?, render?(row) }`. `type`
// picks a default formatter ("date"/"currency"; anything else prints
// the raw value); `render`, when present, overrides that entirely and
// gets the whole row, for a cell that's a link, a badge, or several
// stacked lines rather than plain text. `align` forces left/right
// regardless of `type` -- by default currency/number right-align and
// everything else left-aligns, same rule AdminReports.jsx used.
//
// `renderActions(row)`, when present, appends one trailing unlabeled
// header-less column of row actions (buttons, links) -- `onCellClick`
// isn't needed there since callers putting interactive controls in that
// column already stop propagation themselves where it matters.
//
// `stopRowClick: true` on a column stops its cell's click from reaching
// the row's own `onRowClick` -- for a cell with its own link/control
// (e.g. a partner name linking elsewhere) that would otherwise also
// trigger the row's navigation.
//
// `expandedRowId` + `renderExpanded(row)` support the inline
// edit-row-below-the-row pattern several resource lists use (a trip's
// "Edit" button opening a form in a colSpan'd row directly beneath it)
// without each page re-deriving the colSpan or the <tr> wrapping by
// hand.
//
// `rowAttrs(row)`, when present, spreads extra DOM attributes onto each
// <tr> -- e.g. `data-partner-id` for an e2e spec's locator. Added in
// Phase 2 of the UX-rebuild plan after AdminMonthlySupport.jsx's own
// migration silently dropped the attribute its e2e spec depended on.
//
// `sortable: true` on a column makes its header clickable, sorting rows by
// that column (asc, then desc, then back to asc -- never "unsorted", since
// a caller's own default row order is already a deliberate choice and isn't
// worth a third click state to get back to). Opt-in per column: a caller
// that never sets it keeps its own row order untouched, same as before this
// existed. Sort state lives in this component, not the caller -- there's
// nothing a caller needs to react to, it only ever reorders what's already
// fetched.
function alignClass(column) {
  if (column.align) return column.align === "right" ? "num" : undefined;
  return column.type === "currency" || column.type === "number" ? "num" : undefined;
}

// A real icon, not a Unicode glyph -- ⇅/▲/▼ render inconsistently (and
// bluntly) across platforms/fonts. `direction` is "asc"/"desc" for the
// active column, or null for every other sortable header, which gets the
// muted up+down pair. `currentColor` is deliberate: the `<th>`'s own CSS
// already sets the right color per state (muted/hover/sorted in
// index.css), so this never needs its own color logic.
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

// A sort key, not a display value -- dates/numbers compare numerically
// regardless of `render` overriding what's actually shown, and booleans
// group false-before-true. Anything else falls back to a lowercased
// string compare so case doesn't affect ordering. A column whose cell is
// computed from something other than a plain `row[key]` (e.g. "Last
// Visit" sorting by the first of a `churchVisits` array) supplies its own
// `sortBy(row)` instead, which takes over entirely.
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

  // Always wrapped in .table-scroll (index.css) -- a table with enough
  // columns to not fit a narrow viewport scrolls horizontally within its
  // own box instead of forcing the whole page wider. Harmless for a
  // table that already fits (overflow-x: auto does nothing when there's
  // nothing to scroll), so every caller gets it for free rather than
  // needing to remember the wrapper -- two pages already added it by
  // hand before this was moved in here.
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
