import React from "react";

// The button half of the useLoadMore.js idiom -- pass its three return
// values straight through. Renders nothing once everything's shown
// (hasMore false). Copy-pasted identically at every useLoadMore call site
// across ~11 files (see #135); useLoadMore.js's own header comment already
// explains why this pairing exists.
//
// size: "default" (full admin list pages) or "small" (the per-partner
// *Section.jsx components embedded on AdminPartnerDetail.jsx, which use a
// smaller button and tighter top margin to fit their embedded context --
// a real, deliberate difference between the two groups of call sites, not
// a copy-paste drift.
export default function LoadMoreButton({ hasMore, remaining, onClick, size = "default" }) {
  if (!hasMore) return null;
  const small = size === "small";
  return (
    <button
      type="button"
      className={small ? "btn secondary small" : "btn secondary"}
      style={{ marginTop: small ? "0.5rem" : "1rem" }}
      onClick={onClick}
    >
      Load More ({remaining} remaining)
    </button>
  );
}
