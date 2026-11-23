import React from "react";
import PartnerSelect from "../admin/PartnerSelect.jsx";

// Lives outside FilterBar's generic `fields` model (see FilterBar.jsx's
// own comment on `extraChips`) because this filter is URL-synced --
// reached both by picking a partner here and by arriving via a partner
// page's "View all" link, which FilterBar's local filter state doesn't
// support. `partners` is only required to render the picker; omit it on
// a page that already shows a fixed single partner some other way.
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
