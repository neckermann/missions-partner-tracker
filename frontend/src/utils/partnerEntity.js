// Derives the {type, name, link} an admin table/filter needs to point at
// the partner behind a record (a document, newsletter, prayer request, or
// one-time need) -- "Organization"/"Missionary" label, display name, and
// a link to that partner's admin detail page. null when the record's
// partner is missing (shouldn't happen in practice; every writer requires
// partnerId, but a record predating that constraint or an orphaned
// reference shouldn't crash the page it's listed on).
//
// Copy-pasted near-verbatim across AdminDocuments.jsx, AdminNewsletters.jsx,
// AdminPrayerRequests.jsx, and AdminOneTimeNeeds.jsx (see #135) -- same
// reasoning as utils/format.js for hoisting it once a fix to one copy
// needs to reach the others.
export function entityFor(record) {
  const p = record.partner;
  if (!p) return { type: "—", name: "—", link: null };
  return {
    type: p.kind === "organization" ? "Organization" : "Missionary",
    name: p.displayName,
    link: `/admin/partners/${p.id}`,
  };
}
