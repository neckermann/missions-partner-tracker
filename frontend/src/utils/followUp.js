// A "Follow up by" date on a contact entry is answered once anything is logged for the partner on or
// after that entry's contact date, later than it was entered. This is the same rule the server uses
// for the reminder (backend/src/utils/contactLogQueries.js `openFollowUp`), so the log and the
// reminder never disagree about whether a follow-up is still waiting.
export function isFollowUpOpen(entry, entries) {
  if (!entry?.followUpDate) return false;
  const day = (d) => String(d).slice(0, 10);
  return !entries.some(
    (o) =>
      o.id !== entry.id &&
      day(o.contactDate) >= day(entry.contactDate) &&
      o.createdAt &&
      entry.createdAt &&
      o.createdAt > entry.createdAt
  );
}
