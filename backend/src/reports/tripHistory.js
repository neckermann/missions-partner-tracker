const { z } = require("zod");

// Mission trips across every missionary and organization. Deliberately the
// same filter set as AdminTripHistory.jsx's own Filters panel -- same
// fields, same option values, same semantics -- so a report doesn't feel
// like a second, slightly-different tool someone has to re-learn. Where
// that page's values are "Missionary"/"Organization" (capitalized, singular)
// this report matches that exactly rather than inventing its own casing.
//
// One real difference: the page has no archived-partner toggle at all --
// it shows every trip regardless -- so this report doesn't invent one
// either. Matching the page means matching what it doesn't filter on, too.
module.exports = {
  id: "trip-history",
  requiresFeature: "trips",
  label: "Trip History",
  description: "Mission trips across every partner, with dates, type and team size.",

  params: z.object({
    entityType: z.enum(["all", "Missionary", "Organization"]).default("all"),
    // "all" rather than omitted when unset, because the dynamic <select>
    // this renders as always has an explicit "All" option selected by
    // default (see the frontend's initialValues) -- there's no bare/blank
    // state to distinguish from "all" the way a date field has "".
    tripType: z.string().default("all"),
    year: z.union([z.literal("all"), z.coerce.number().int()]).default("all"),
    minTeamSize: z.coerce.number().int().nonnegative().optional(),
    maxTeamSize: z.coerce.number().int().nonnegative().optional(),
  }),

  fields: [
    {
      name: "entityType",
      label: "Partner Type",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "Missionary", label: "Missionary" },
        { value: "Organization", label: "Organization" },
      ],
    },
    // tripType and year have no static `options` -- resolveFields below
    // fills them in from what's actually on file, the same way the page's
    // own tripTypeOptions/yearOptions are built from its loaded trips
    // rather than a hardcoded list.
    { name: "tripType", label: "Trip Type", type: "select", options: [{ value: "all", label: "All" }] },
    { name: "year", label: "Year", type: "select", options: [{ value: "all", label: "All" }] },
    { name: "minTeamSize", label: "Min Team Size", type: "number" },
    { name: "maxTeamSize", label: "Max Team Size", type: "number" },
  ],

  // Builds this report's two dynamic <select>s from the trip types and
  // years actually in the database -- the server-side equivalent of the
  // page's tripTypeOptions/yearOptions useMemo. Runs once per GET
  // /api/reports (the picker), not per report run, so this is one cheap
  // distinct query against a table that's a few hundred rows at most.
  async resolveFields(prisma) {
    const trips = await prisma.trip.findMany({ select: { tripType: true, startDate: true } });

    const tripTypes = [...new Set(trips.map((t) => t.tripType).filter(Boolean))].sort();
    const years = [...new Set(trips.map((t) => t.startDate?.getUTCFullYear()).filter(Boolean))].sort(
      (a, b) => b - a
    );

    return this.fields.map((field) => {
      if (field.name === "tripType") {
        return {
          ...field,
          options: [{ value: "all", label: "All" }, ...tripTypes.map((t) => ({ value: t, label: t }))],
        };
      }
      if (field.name === "year") {
        return {
          ...field,
          options: [
            { value: "all", label: "All" },
            ...years.map((y) => ({ value: String(y), label: String(y) })),
          ],
        };
      }
      return field;
    });
  },

  // `type` is a rendering hint for the table only -- the CSV always carries
  // the raw value, so a spreadsheet gets a real number and an ISO date
  // rather than formatted text.
  columns: [
    { key: "startDate", label: "Start", type: "date" },
    { key: "endDate", label: "End", type: "date" },
    { key: "partnerName", label: "Partner" },
    { key: "partnerType", label: "Type" },
    { key: "tripType", label: "Trip Type" },
    { key: "teamSize", label: "Team Size", type: "number" },
    { key: "leaders", label: "Leader(s)" },
    { key: "description", label: "Description" },
  ],

  async run(params, prisma) {
    const where = {};
    if (params.entityType !== "all") where.partner = { kind: params.entityType.toLowerCase() };
    if (params.tripType !== "all") where.tripType = params.tripType;
    if (params.year !== "all") {
      where.startDate = {
        gte: new Date(Date.UTC(params.year, 0, 1)),
        lt: new Date(Date.UTC(params.year + 1, 0, 1)),
      };
    }

    const trips = await prisma.trip.findMany({
      where,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        tripType: true,
        description: true,
        partner: { select: { id: true, displayName: true, kind: true } },
        participants: { select: { name: true, isLeader: true } },
      },
      orderBy: [{ startDate: "desc" }],
    });

    // Team size is a count of a relation, not a column, so it's filtered
    // here rather than in the Prisma `where` -- same as the page, which
    // computes `size` client-side and filters on it in plain JS. The
    // dataset is a few hundred trips at most; a second round trip to do
    // this in SQL would be more code for no real benefit at this scale.
    return trips
      .map((t) => ({
        id: t.id,
        startDate: t.startDate,
        endDate: t.endDate,
        partnerId: t.partner.id,
        partnerName: t.partner.displayName,
        partnerType: t.partner.kind === "organization" ? "Organization" : "Missionary",
        tripType: t.tripType || null,
        teamSize: t.participants.length,
        leaders:
          t.participants
            .filter((p) => p.isLeader)
            .map((p) => p.name)
            .join(", ") || null,
        description: t.description,
      }))
      .filter((t) => params.minTeamSize === undefined || t.teamSize >= params.minTeamSize)
      .filter((t) => params.maxTeamSize === undefined || t.teamSize <= params.maxTeamSize);
  },
};
