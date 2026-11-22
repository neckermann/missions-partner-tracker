// Cuts a long string to `max` characters with a trailing ellipsis -- for a
// one-line summary (a Partner Detail summary card, a consolidated list
// page's table cell) that shouldn't wrap a long request/description across
// several lines. Previously duplicated as a local function in
// AdminPartnerDetail.jsx; pulled out once AdminPrayerRequests.jsx/
// AdminOneTimeNeeds.jsx needed the exact same behavior for their own list
// rows.
export function truncate(text, max) {
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
