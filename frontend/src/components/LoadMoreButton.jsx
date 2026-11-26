import React from "react";

// The button half of the useLoadMore.js idiom: pass its three return values through. Renders
// nothing once everything is shown. size "default" is for full admin list pages; "small" for the
// per-partner *Section.jsx components embedded on AdminPartnerDetail.jsx (deliberately smaller).
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
