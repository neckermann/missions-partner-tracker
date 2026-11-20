import React from "react";
import { Link } from "react-router-dom";

// `items`: [{ label, to? }]. The last item is always rendered as the
// current page (bold, no link) regardless of whether it carries a `to` --
// earlier items need one to be useful, but a caller that still passes one
// for the last item is simply ignored rather than producing a dead link
// to the page already on screen.
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
