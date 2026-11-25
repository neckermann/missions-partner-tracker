import React from "react";
import PartnerSelect from "../admin/PartnerSelect.jsx";

// Outside FilterBar's `fields` model (see `extraChips`) because this filter is URL-synced: reached
// by picking a partner or via a partner page's "View all" link. `partners` is only needed to render
// the picker; omit it on a page showing a fixed single partner.
export default function PartnerFilterChip({ partnerId, partnerName, partners, onSelect, onClear }) {
  if (!partnerId) {
    if (!partners) return null;
    return (
      <span className="filter-chip">
        <span className="filter-chip-label">Partner:</span>
        <PartnerSelect partners={partners} value="" onChange={onSelect} includeArchived />
      </span>
    );
  }
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
