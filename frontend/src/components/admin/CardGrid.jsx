import React from "react";
import { Link } from "react-router-dom";

// A labeled grid of link cards. `sections` is `[{ to, title, description, category?, icon? }]`;
// `category` renders as an eyebrow label, `icon` inline before the title (matching AdminSidebar).
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
