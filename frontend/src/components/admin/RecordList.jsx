import React from "react";
import LoadMoreButton from "../LoadMoreButton.jsx";
import { onClickUnlessSelecting } from "../../utils/clickableRow.js";

// The display half of a small parent-scoped record list; each row is its own record, so
// Edit/Delete act on one row. Pairs with usePartnerRecordCrud.jsx. `addLabel: null` hides Add.
// `canEdit`/`canDelete` are independent (delete permission varies by resource); `canEdit` false
// also makes rows non-clickable. `hasMore`/`remaining`/`onShowMore` (from useLoadMore.js) render a
// Load More button. `bare` renders just the row list, for nesting inside a card that supplies its
// own heading.
export default function RecordList({
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
  bare = false,
  canEdit = true,
  canDelete = true,
}) {
  const showAdd = canEdit && addLabel;
  const rows = (
    <>
      {(title || showAdd) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {title ? (
            <h3 style={{ margin: 0 }}>
              {icon && <span aria-hidden="true">{icon} </span>}
              {title}
            </h3>
          ) : (
            <span />
          )}
          {showAdd && (
            <button type="button" className="btn secondary small" onClick={onAdd}>
              {addLabel}
            </button>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>{emptyMessage}</p>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className={canEdit ? "repeatable-row repeatable-row-clickable" : "repeatable-row"}
            style={{ marginTop: "0.75rem" }}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onClick={canEdit ? onClickUnlessSelecting(() => onEdit(item)) : undefined}
            onKeyDown={
              canEdit
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onEdit(item);
                    }
                  }
                : undefined
            }
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "1rem",
              }}
            >
              {/* minWidth: 0 and overflowWrap let a long unbreakable value (a URL) wrap instead of
                  pushing the Edit/Delete buttons off the screen on a phone. */}
              <div
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  flexWrap: "wrap",
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {renderItem(item)}
              </div>
              {(canEdit || canDelete) && (
                // Not interactive itself: stops clicks/keydowns on the inner buttons bubbling to the row handler.
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <div
                  style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {canEdit && (
                    <button type="button" className="btn secondary small" onClick={() => onEdit(item)}>
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="btn danger small" onClick={() => onDelete(item)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))
      )}
      {onShowMore && (
        <LoadMoreButton hasMore={hasMore} remaining={remaining} onClick={onShowMore} size="small" />
      )}
    </>
  );

  if (bare) return rows;
  return <div className="admin-section">{rows}</div>;
}
