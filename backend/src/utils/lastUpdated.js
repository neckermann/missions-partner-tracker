// "Last updated" for a master record (partner, trip) as a person reads it: the
// latest change to the record OR any section on its page (family, addresses, links,
// visits, support; team, meetings, requirements, documents, money). The stamp
// (lastEditedBy*/At, written by the Prisma extension in prismaClient.js) lives on
// each row, so this reads across them.
//
// Done at read time, not by also stamping the parent on every child write: that
// second write would run outside the request's transaction and could block on the
// parent row it holds. One UNION query over a fixed table list (never user input).
//
// Deletes are not seen. Notes, prayer requests, needs, newsletters and contact-log
// entries have their own pages and aren't folded into the date.
const prisma = require("../prismaClient");

const direct = (table, fk) => ({
  from: `"${table}"`,
  key: `"${fk}"`,
  at: `"lastEditedAt"`,
  name: `"lastEditedByName"`,
});

const PARTNER_SECTIONS = [
  "Adult",
  "Child",
  "Address",
  "Furlough",
  "ChurchVisit",
  "PartnerLink",
  "PartnerLanguage",
  "SendingParty",
  "SupportEntry",
  "Photo",
].map((t) => direct(t, "partnerId"));

const TRIP_SECTIONS = [
  "TripParticipant",
  "TripApplication",
  "TripMeeting",
  "TripRequirement",
  "TripDocument",
  "TripContribution",
  "TripBudgetLine",
  "TripFlightSegment",
]
  .map((t) => direct(t, "tripId"))
  .concat([
    // A participant's requirement status carries no tripId of its own.
    {
      from: `"TripRequirementStatus" s JOIN "TripParticipant" tp ON tp.id = s."participantId"`,
      key: `tp."tripId"`,
      at: `s."lastEditedAt"`,
      name: `s."lastEditedByName"`,
    },
  ]);

// The newest of {at, name} candidates, ignoring unstamped ones. Pure.
function latestOf(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!c?.at) continue;
    if (!best || new Date(c.at) > new Date(best.at)) best = { at: c.at, name: c.name ?? null };
  }
  return best;
}

async function lastUpdatedMap(parentTable, sections, ids, db = prisma) {
  if (ids && ids.length === 0) return new Map();
  const filter = (col) => (ids ? ` AND ${col} = ANY($1::text[])` : "");
  const parts = [
    `SELECT id AS pid, "lastEditedAt" AS at, "lastEditedByName" AS name FROM "${parentTable}" WHERE "lastEditedAt" IS NOT NULL${filter("id")}`,
    ...sections.map(
      (s) =>
        `SELECT ${s.key} AS pid, ${s.at} AS at, ${s.name} AS name FROM ${s.from} WHERE ${s.at} IS NOT NULL AND ${s.key} IS NOT NULL${filter(s.key)}`
    ),
  ];
  const sql = `SELECT DISTINCT ON (pid) pid, at, name FROM (${parts.join(" UNION ALL ")}) t ORDER BY pid, at DESC`;
  const rows = ids ? await db.$queryRawUnsafe(sql, ids) : await db.$queryRawUnsafe(sql);
  return new Map(rows.map((r) => [r.pid, { at: r.at, name: r.name }]));
}

const partnerLastUpdated = (ids, db) => lastUpdatedMap("Partner", PARTNER_SECTIONS, ids, db);
const tripLastUpdated = (ids, db) => lastUpdatedMap("Trip", TRIP_SECTIONS, ids, db);

// Fields to merge onto a list row.
const listFields = (entry) => ({
  lastUpdatedAt: entry?.at ?? null,
  lastUpdatedByName: entry?.name ?? null,
});

module.exports = {
  latestOf,
  partnerLastUpdated,
  tripLastUpdated,
  listFields,
  PARTNER_SECTIONS,
  TRIP_SECTIONS,
};
