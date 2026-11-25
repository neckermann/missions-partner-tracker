import React from "react";

// A row of count tiles: a large number, a short label, and an optional quieter hint ("of 74
// total"). One look for every "how many" strip in the app, so a count reads the same on the Trips
// list, the email subscriber summary and the reports (which share the same CSS). Theme tokens only.
export default function StatTiles({ items, ariaLabel }) {
  return (
    <dl className="stat-tiles" aria-label={ariaLabel}>
      {items.map((it) => (
        <div className="stat-tile" key={it.label}>
          <dt>{it.label}</dt>
          <dd>
            {it.value}
            {it.hint && <span className="stat-tile-hint"> {it.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
