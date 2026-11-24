// "Organization"/"Missionary" label from a partner's `kind`. Its own
// export because some callers build a merged row object with other
// fields interleaved (AdminMonthlySupport.jsx, AdminTripOpportunities.jsx,
// AdminTripHistory.jsx) rather than entityFor()'s full {type, name, link}
// triple below -- copy-pasted inline in all three (see #135) before this.
// `kind` missing/undefined (an absent partner) falls through to
// "Missionary", matching every call site's prior behavior.
export function partnerKindLabel(kind) {
  return kind === "organization" ? "Organization" : "Missionary";
}

// Derives the {type, name, link} an admin table/filter needs to point at
// the partner behind a record (a partner file, prayer request, or
// one-time need) -- label (via partnerKindLabel above), display name, and
// a link to that partner's admin detail page. null when the record's
// partner is missing (shouldn't happen in practice; every writer requires
// partnerId, but a record predating that constraint or an orphaned
// reference shouldn't crash the page it's listed on).
//
// Copy-pasted near-verbatim across AdminPartnerFiles.jsx,
// AdminPrayerRequests.jsx, and AdminOneTimeNeeds.jsx (see #135) -- same
// reasoning as utils/format.js for hoisting it once a fix to one copy
// needs to reach the others.
export function entityFor(record) {
  const p = record.partner;
  if (!p) return { type: "—", name: "—", link: null };
  return {
    type: partnerKindLabel(p.kind),
    name: p.displayName,
    link: `/admin/partners/${p.id}`,
  };
}

// Shared FilterBar (components/shared/FilterBar.jsx) field definitions for
// the two filter concepts that repeat across AdminPartners.jsx,
// AdminPartnerFiles.jsx, AdminTrips.jsx, AdminPrayerRequests.jsx,
// AdminOneTimeNeeds.jsx, and AdminMonthlySupport.jsx -- spread into each
// page's own `fields` array so their name/label/options stay identical.
export const PARTNER_TYPE_FILTER_FIELD = {
  name: "entityType",
  label: "Partner Type",
  type: "select",
  options: [
    { value: "all", label: "All" },
    { value: "missionary", label: "Missionaries" },
    { value: "organization", label: "Organizations" },
  ],
};

export const INCLUDE_ARCHIVED_PARTNERS_FILTER_FIELD = {
  name: "includeArchived",
  label: "Include archived partners",
  type: "checkbox",
};

// "Sending church" -- the church that sent the partner, ours included ("Sent by us").
// Its options are loaded from the server by useSendingChurchField (hooks/), so this
// is only the shape; the list is every church any partner has, not a fixed set.
export const SENDING_CHURCH_FILTER_FIELD = {
  name: "sendingChurch",
  label: "Sending church",
  type: "select",
  options: [{ value: "all", label: "All" }],
};
