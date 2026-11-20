import React from "react";

export default function PartnerFilterChip({ partnerId, partnerName, onClear }) {
  if (!partnerId) return null;
  return (
    <span className="filter-chip on">
      <span className="filter-chip-label">Partner:</span>
      {partnerName || "…"}
      <button type="button" className="fc-x" onClick={onClear} aria-label="Clear partner filter">
        ✕
      </button>
    </span>
  );
}
