import React from "react";
import { Link } from "react-router-dom";
import LoadMoreButton from "../LoadMoreButton.jsx";

// A lightweight stand-in for an embedded CRUD widget on Partner Detail, for a collection with its
// own admin page: the title links there pre-filtered (a plain title without `viewAllTo`), and `actions`
// open the real add/edit forms in a QuickActionModal. `items` lists a few recent entries instead
// of the one-line `summary`; each is a string or `{ text, onClick }`. `hasMore`/`remaining`/
// `onShowMore` (from useLoadMore.js) render Load More under `items`. `empty` replaces "None on file."
export default function PartnerSummaryCard({
  icon,
  title,
  count,
  summary,
  items,
  hasMore,
  remaining,
  onShowMore,
  viewAllTo,
  actions,
  empty = "None on file.",
}) {
  return (
    <div className="admin-section partner-summary-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>
          <span aria-hidden="true">{icon}</span>{" "}
          {viewAllTo ? (
            <Link to={viewAllTo} className="summary-item-link" title={`See all ${title.toLowerCase()}`}>
              {title} →
            </Link>
          ) : (
            title
          )}
        </h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {actions?.map((action) => (
            <button key={action.label} type="button" className="btn secondary small" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
      {count === 0 && <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>{empty}</p>}
      {count > 0 && summary && <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>{summary}</p>}
      {count > 0 && items?.length > 0 && (
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", color: "var(--muted)" }}>
          {items.map((item, i) => {
            const isClickable = item && typeof item === "object";
            return (
              <li key={i}>
                {isClickable ? (
                  <button type="button" className="summary-item-link" onClick={item.onClick}>
                    {item.text}
                  </button>
                ) : (
                  item
                )}
              </li>
            );
          })}
        </ul>
      )}
      {onShowMore && (
        <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={onShowMore} size="small" />
      )}
    </div>
  );
}
