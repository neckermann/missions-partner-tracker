import React from "react";
import LoadMoreButton from "../LoadMoreButton.jsx";

// The display half of the small partner-scoped record lists on Partner
// Detail (Adults, Children, Furloughs, Church Visits, Links, Languages) --
// each row is its own real record with its own id, so Edit/Delete act on
// just that one row, never the whole list. Pairs with
// usePartnerRecordCrud.jsx for the add/edit/delete plumbing behind the
// buttons. `addLabel: null` hides the Add button entirely (Links uses this
// once every type is already on file).
// `hasMore`/`remaining`/`onShowMore`, when given (straight from a caller's
// own useLoadMore.js), render a "Load More" button below the list -- for
// a list capped to a few rows by default instead of showing everything.
export default function PartnerRecordList({
  title,
  icon,
  items,
  renderItem,
  onAdd,
  addLabel = "+ Add",
  onEdit,
  onDelete,
  emptyMessage = "None on file.",
  hasMore,
  remaining,
  onShowMore,
}) {
  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {icon && <span aria-hidden="true">{icon} </span>}
          {title}
        </h3>
        {addLabel && (
          <button type="button" className="btn secondary small" onClick={onAdd}>
            {addLabel}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p style={{ color: "#888", marginTop: "0.5rem" }}>{emptyMessage}</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="repeatable-row" style={{ marginTop: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>{renderItem(item)}</div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button type="button" className="btn secondary small" onClick={() => onEdit(item)}>
                  Edit
                </button>
                <button type="button" className="btn danger small" onClick={() => onDelete(item)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))
      )}
      {onShowMore && <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={onShowMore} size="small" />}
    </div>
  );
}
