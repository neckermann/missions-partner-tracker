import React from "react";
import { Link } from "react-router-dom";

// Shared by AdminHome.jsx's Settings section and
// AdminPartnerCare.jsx's own landing page -- a labeled grid of link
// cards, each pointing at one page. `sections` is `[{ to, title,
// description }]`.
export default function CardGrid({ sections }) {
  return (
    <div className="admin-card-grid">
      {sections.map((s) => (
        <Link key={s.to} to={s.to} className="admin-card">
          <h3>{s.title}</h3>
          <p>{s.description}</p>
        </Link>
      ))}
    </div>
  );
}
