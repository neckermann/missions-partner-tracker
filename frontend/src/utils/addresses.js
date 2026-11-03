// Pulls the one address of a given type out of a partner's `addresses`
// array -- a partner has at most one "physical" and one "mailing" address
// (see the Address model), so this is always a find, never a filter.
// Copy-pasted identically across AdminPartners.jsx, AdminPartnerDetail.jsx,
// and AdminBooklet.jsx (see #135).
export function addressByType(addresses, type) {
  return (addresses || []).find((a) => a.type === type);
}
