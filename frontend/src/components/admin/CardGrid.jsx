import React from "react";
import { Link } from "react-router-dom";

// A labeled grid of link cards, each pointing at one page. `sections` is
// `[{ to, title, description, category?, icon? }]`. `category`, when
// present, renders as a small eyebrow label above the title (e.g.
// "Communications", "Trips"). `icon` renders inline before the title,
// matching AdminSidebar.jsx's own icon per destination. Both optional so
// existing call sites don't have to pass them.
export default function CardGrid({ sections }) {
  return (
    <div className="admin-card-grid">
      {sections.map((s) => (
        <Link key={s.to} to={s.to} className="admin-card">
          {s.category && <span className="admin-card-eyebrow">{s.category}</span>}
          <h3>
            {s.icon && (
              <span aria-hidden="true" className="admin-card-icon">
                {s.icon}
              </span>
            )}
            {s.title}
          </h3>
          <p>{s.description}</p>
        </Link>
      ))}
    </div>
  );
}
