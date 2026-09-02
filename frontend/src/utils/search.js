// Shared text-search matching for the app's free-text search boxes
// (public directory, admin partners, admin trip opportunities).
//
// Two things a plain `.includes()` search gets wrong for this app's data:
// - Diacritics: a search for "sao tome" should match "São Tomé", and
//   "curacao" should match "Curaçao" -- increasingly relevant now that
//   COUNTRY_CENTROIDS covers every country, not just a hand-picked few.
// - Multi-word queries: "Tim Uganda" should match a record whose name
//   contains "Tim" and whose field contains "Uganda", not fail just
//   because those two words never appear together as one substring.
// Unicode combining diacritical marks block (U+0300-U+036F) -- what a
// decomposed accented character (NFD) breaks the accent mark into.
const DIACRITICS_PATTERN = "\\u0300-\\u036f";
const DIACRITICS = new RegExp("[" + DIACRITICS_PATTERN + "]", "g");

function normalize(value) {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase();
}

// Every word in `query` must appear somewhere across `fields`, in any
// order -- an AND match, not a single combined substring. An empty query
// matches everything.
export function matchesSearch(query, ...fields) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.map(normalize).join(" ");
  return words.every((word) => haystack.includes(word));
}
