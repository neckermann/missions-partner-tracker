import React from "react";
import { Link } from "react-router-dom";

// `items`: [{ label, to? }]. The last item is always the current page (bold, no link), even if it
// carries a `to`.
export default function Breadcrumb({ items }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={item.to || item.label}>
            {i > 0 && <span className="breadcrumb-sep">›</span>}
            {item.to && !isLast ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span className="breadcrumb-current">{item.label}</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
