// Shared text matching for the free-text search boxes. Beyond plain `.includes()`: it ignores
// diacritics ("sao tome" matches "São Tomé") and treats a multi-word query as AND across fields
// ("Tim Uganda" matches a name with "Tim" and a field with "Uganda").
// Unicode combining diacritical marks (U+0300-U+036F): what NFD splits an accent into.
const DIACRITICS_PATTERN = "\\u0300-\\u036f";
const DIACRITICS = new RegExp("[" + DIACRITICS_PATTERN + "]", "g");

function normalize(value) {
  return (value ?? "").toString().normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

// Every word in `query` must appear somewhere across `fields`, in any order. Empty matches all.
export function matchesSearch(query, ...fields) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.map(normalize).join(" ");
  return words.every((word) => haystack.includes(word));
}
