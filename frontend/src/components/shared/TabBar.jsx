import React from "react";
import { NavLink } from "react-router-dom";

// The one underline tab row used wherever a page switches between views of the same thing
// (Trips, a trip's own pages, Partners). A tab is either a route link (`to`, optional `end`) or
// a button (`onClick`), and either way it looks the same: muted until active, then the full text
// colour with a brand underline. All colours come from theme tokens, so it reads in both themes.
export default function TabBar({ tabs, activeKey, ariaLabel }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="tab-bar">
      {tabs.map((t) => {
        const key = t.key ?? t.to ?? t.label;
        if (t.to !== undefined) {
          return (
            <NavLink
              key={key}
              to={t.to}
              end={t.end}
              className={({ isActive }) => (isActive ? "tab active" : "tab")}
            >
              {t.label}
            </NavLink>
          );
        }
        const active = activeKey === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "tab active" : "tab"}
            onClick={t.onClick}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
