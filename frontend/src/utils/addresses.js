// Pulls the one address of a given type from a partner's `addresses` (at most one "physical" and
// one "mailing"), so this is a find, never a filter.
export function addressByType(addresses, type) {
  return (addresses || []).find((a) => a.type === type);
}
