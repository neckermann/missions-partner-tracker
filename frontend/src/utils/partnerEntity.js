// "Organization"/"Missionary" label from a partner's `kind` (missing kind falls through to
// "Missionary"). Its own export for callers that build merged rows rather than entityFor()'s triple.
export function partnerKindLabel(kind) {
  return kind === "organization" ? "Organization" : "Missionary";
}

// Derives the {type, name, link} an admin table/filter needs to point at the partner behind a
// record (partner file, prayer request, one-time need). null when the partner is missing, so an
// orphaned reference can't crash the list.
export function entityFor(record) {
  const p = record.partner;
  if (!p) return { type: "—", name: "—", link: null };
  return {
    type: partnerKindLabel(p.kind),
    name: p.displayName,
    link: `/admin/partners/${p.id}`,
  };
}

// Shared FilterBar field definitions for filters that repeat across the admin list pages; spread
// into each page's `fields` so name/label/options stay identical.
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

// "Sending church": the church that sent the partner, ours included ("Sent by us"). Options are
// loaded by useSendingChurchField (hooks/); this is only the shape.
export const SENDING_CHURCH_FILTER_FIELD = {
  name: "sendingChurch",
  label: "Sending church",
  type: "select",
  options: [{ value: "all", label: "All" }],
};
