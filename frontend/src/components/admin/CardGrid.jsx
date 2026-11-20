import React from "react";
import { Link } from "react-router-dom";

// A labeled grid of link cards, each pointing at one page. `sections` is
// `[{ to, title, description, category? }]`. `category`, when present,
// renders as a small eyebrow label above the title (e.g.
// "Communications", "Trips") -- optional so existing call sites don't
// have to pass it.
export default function CardGrid({ sections }) {
  return (
    <div className="admin-card-grid">
      {sections.map((s) => (
        <Link key={s.to} to={s.to} className="admin-card">
          {s.category && <span className="admin-card-eyebrow">{s.category}</span>}
          <h3>{s.title}</h3>
          <p>{s.description}</p>
        </Link>
      ))}
    </div>
  );
}
