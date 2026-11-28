import React from "react";

// What a list shows when it has no rows. Two different situations, told apart, because "No partners match these
// filters" on a list that simply has nothing in it yet is wrong and leaves a new person with nowhere to go:
//   - filtered: something exists but the filters hide it. Say so, and offer to clear them.
//   - not filtered: nothing has been added yet. Say what the list is for, and offer the first step (`children`).
export function filtersActive(values, defaults) {
  return Object.keys(defaults).some((key) => String(values[key] ?? "") !== String(defaults[key] ?? ""));
}

export default function EmptyListMessage({ filtered, filteredText, onClear, children }) {
  if (filtered) {
    return (
      <span>
        {filteredText}{" "}
        {onClear && (
          <button type="button" className="btn secondary small" onClick={onClear}>
            Clear filters
          </button>
        )}
      </span>
    );
  }
  return <span>{children}</span>;
}
