// Cuts a long string to `max` characters with a trailing ellipsis, for one-line summaries.
export function truncate(text, max) {
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
