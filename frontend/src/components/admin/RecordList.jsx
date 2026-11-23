import React from "react";
import LoadMoreButton from "../LoadMoreButton.jsx";
import { onClickUnlessSelecting } from "../../utils/clickableRow.js";

// The display half of a small parent-scoped record list (Adults, Children,
// Furloughs, Church Visits, Links, Languages, Trip Types on Partner Detail;
// Trip Meetings/Requirements/Budget Lines/Flight Segments on a Trip) --
// each row is its own real record with its own id, so Edit/Delete act on
// just that one row, never the whole list. Pairs with
// usePartnerRecordCrud.jsx for the add/edit/delete plumbing behind the
// buttons. `addLabel: null` hides the Add button entirely (Links uses this
// once every type is already on file).
//
// `canEdit`/`canDelete`: independent, because delete permission genuinely
// varies by resource (some allow editor-delete, most don't -- see the
// app-wide CRUD unification plan's role-gating table). `canEdit` also
// gates whether a row is clickable at all -- when false (a viewer), rows
// show their content but aren't a click target, since there's no read-only
// detail popup wired at this generic level for every caller yet (each
// resource's own page already has, or is gaining, that via its own
// add/edit modal branching on role).
//
// `hasMore`/`remaining`/`onShowMore`, when given (straight from a caller's
// own useLoadMore.js), render a "Load More" button below the list -- for
// a list capped to a few rows by default instead of showing everything.
//
// `bare`: skips the outer `admin-section` card + its own heading/Add
// button row, rendering just the row list (+ Load More) -- for nesting
// this list inside another card that already supplies its own heading/
// chrome (e.g. Trip Types Supported nested inside the Trip Capacity
// EditableSection, so the two read as one card instead of two). The
// add/edit/delete plumbing is unchanged either way; only the wrapper/
// heading is suppressed, so pass `onAdd`/`addLabel` as `undefined` too if
// the host card's own header already provides its own "+ Add" affordance.
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
        <p style={{ color: "#888", marginTop: "0.5rem" }}>{emptyMessage}</p>
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
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>{renderItem(item)}</div>
              {(canEdit || canDelete) && (
                // Not itself interactive -- just stops clicks/keydowns on the
                // real buttons inside from bubbling into the row's own
                // open-on-activate handler above.
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
