const { z } = require("zod");

// Mission trips across every missionary and organization, filterable by
// year, entity kind and trip type -- a year-in-review shape for a board or
// missions committee.
module.exports = {
  id: "trip-history",
  requiresFeature: "trips",
  label: "Trip History",
  description: "Mission trips across every partner, with dates, type and team size.",

  params: z.object({
    // A calendar year on startDate, not a date range -- matches how
    // AdminTripHistory.jsx's own year filter works, and "trips in 2026" is
    // the question this report actually gets asked.
    year: z.coerce.number().int().min(1900).max(2200).optional(),
    entityType: z.enum(["all", "missionary", "organization"]).default("all"),
    tripType: z.string().optional(),
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  fields: [
    { name: "year", label: "Year", type: "number" },
    {
      name: "entityType",
      label: "Partner type",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "missionary", label: "Missionaries" },
        { value: "organization", label: "Organizations" },
      ],
    },
    { name: "tripType", label: "Trip type", type: "text" },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],

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
    if (params.entityType !== "all") where.partner = { kind: params.entityType };
    if (params.tripType) where.tripType = params.tripType;
    if (!params.includeArchived) {
      where.partner = { ...(where.partner || {}), archived: false };
    }
    if (params.year) {
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
        partner: { select: { id: true, displayName: true, kind: true, archived: true } },
        participants: { select: { name: true, isLeader: true } },
      },
      orderBy: [{ startDate: "desc" }],
    });

    return trips.map((t) => ({
      id: t.id,
      startDate: t.startDate,
      endDate: t.endDate,
      partnerId: t.partner.id,
      partnerName: t.partner.displayName,
      partnerType: t.partner.kind === "organization" ? "Organization" : "Missionary",
      tripType: t.tripType || null,
      teamSize: t.participants.length || null,
      leaders:
        t.participants
          .filter((p) => p.isLeader)
          .map((p) => p.name)
          .join(", ") || null,
      description: t.description,
      archived: Boolean(t.partner.archived),
    }));
  },
};
