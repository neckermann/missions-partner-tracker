// "When did we last hear from this partner?" -- the one answer behind every "quiet" decision (the
// My partners tab and its bell item, and the care chat's quiet-partner post). Anything that shows
// the partner is alive resets the clock: a logged contact, a newsletter filed, a prayer request
// received, or a visit to our church. Dated in the future does not count (nothing has happened yet).
// A photo does not: it can be filed for them without them being in touch. The Last heard from
// report reads the same four sources.
const prisma = require("../prismaClient");

// Map of partnerId -> latest date (a Date) across the four sources, as of `today` (a UTC-day Date).
// `partnerIds` narrows the lookup; omit it for every partner. A partner never heard from is absent.
async function lastHeardFromByPartner(partnerIds, today = new Date()) {
  if (partnerIds && partnerIds.length === 0) return new Map();
  const scope = partnerIds ? { partnerId: { in: partnerIds } } : {};
  const [contacts, newsletters, prayers, visits] = await Promise.all([
    prisma.contactLog.groupBy({
      by: ["partnerId"],
      where: { ...scope, contactDate: { lte: today } },
      _max: { contactDate: true },
    }),
    prisma.partnerFile.groupBy({
      by: ["partnerId"],
      where: { ...scope, kind: "newsletter", receivedDate: { lte: today } },
      _max: { receivedDate: true },
    }),
    prisma.prayerRequest.groupBy({
      by: ["partnerId"],
      where: { ...scope, dateReceived: { lte: today } },
      _max: { dateReceived: true },
    }),
    prisma.churchVisit.groupBy({
      by: ["partnerId"],
      where: { ...scope, visitDate: { lte: today } },
      _max: { visitDate: true },
    }),
  ]);
  const latest = new Map();
  const take = (rows, field) => {
    for (const r of rows) {
      const d = r._max[field];
      if (d && (!latest.has(r.partnerId) || d > latest.get(r.partnerId))) latest.set(r.partnerId, d);
    }
  };
  take(contacts, "contactDate");
  take(newsletters, "receivedDate");
  take(prayers, "dateReceived");
  take(visits, "visitDate");
  return latest;
}

module.exports = { lastHeardFromByPartner };
