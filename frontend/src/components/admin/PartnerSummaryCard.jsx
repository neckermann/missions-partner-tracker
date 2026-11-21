import React from "react";
import { Link } from "react-router-dom";
import LoadMoreButton from "../LoadMoreButton.jsx";

// A lightweight stand-in for a full embedded CRUD widget on Partner
// Detail, for a collection that already has its own real, filterable
// admin page elsewhere (One-Time Needs, Trips, Prayer Requests,
// Newsletters & Docs) -- managing those moves entirely to that page,
// pre-filtered to this partner via "View all", omitted when there's no
// `viewAllTo` (Monthly Support's consolidated page is being pulled out,
// so everything for it now lives right here instead). `actions` (e.g.
// "+ Add", "Mark Answered") open the real add/edit forms in a quick popup
// right here instead -- see QuickActionModal.jsx -- so this still isn't a
// second copy of those forms, just a faster way to reach the same ones.
// `items`, when given, lists up to a few of the most recent entries (one
// per line) instead of the single-line `summary`. An item is either a
// pre-formatted string, or `{ text, onClick }` to make that one row open
// something (a view/edit popup, say) -- this component doesn't know how
// to summarize or act on a record, just how to lay out what it's handed.
// `hasMore`/`remaining`/`onShowMore`, when given (straight from a caller's
// own useLoadMore.js), render a "Load More" button under `items` -- for a
// card whose everything lives right here instead of behind "View all".
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
}) {
  return (
    <div className="admin-section partner-summary-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {actions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className="btn secondary small"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
          {viewAllTo && (
            <Link to={viewAllTo} className="btn secondary small">
              View all →
            </Link>
          )}
        </div>
      </div>
      {count === 0 && <p style={{ margin: "0.5rem 0 0", color: "#555" }}>None on file.</p>}
      {count > 0 && summary && <p style={{ margin: "0.5rem 0 0", color: "#555" }}>{summary}</p>}
      {count > 0 && items?.length > 0 && (
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", color: "#555" }}>
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
      {onShowMore && <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={onShowMore} size="small" />}
    </div>
  );
}
