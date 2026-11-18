import React from "react";

// Shared filter-bar shell for both Trips tabs ("Existing Trips" and
// "Plan a Trip") -- before this, each page built its own filter chrome
// from scratch (a boxed "Filters" section with a dropdown-per-field and
// a Reset button below, vs. a bare unboxed row of pill buttons + inline
// fields + a checkbox). Neither tab's actual FILTERS are shared --
// Existing Trips needs Partner Type/Trip Type/Year/Min-Max Team Size,
// Plan a Trip needs search/trip-type/team-size/"never been" -- only the
// surrounding shell (box, optional quick-filter pills, field layout,
// Reset button) is, so the two tabs can't visually diverge again the way
// they had.
//
// `pills` is optional -- a tab with no small, well-known enum to quick-
// filter on (there isn't one today, but a future tab might not need
// this row) just omits it rather than rendering an empty row.
export default function TripFilterBar({ pills, onReset, children }) {
  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Filters</h3>
        <button type="button" className="btn secondary small" onClick={onReset}>
          Reset Filters
        </button>
      </div>
      {pills && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {pills.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={pills.value === opt.value ? "btn small" : "btn secondary small"}
              onClick={() => pills.onChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <div className="form-grid" style={{ marginTop: "0.75rem" }}>
        {children}
      </div>
    </div>
  );
}
