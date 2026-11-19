import React from "react";
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
function alignClass(column) {
  if (column.align) return column.align === "right" ? "num" : undefined;
  return column.type === "currency" || column.type === "number" ? "num" : undefined;
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

  return (
    <table className={className} style={style}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={alignClass(c)}>
              {c.label}
            </th>
          ))}
          {renderActions && <th></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
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
            <td colSpan={colSpan || 1} style={{ color: "#888" }}>
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
