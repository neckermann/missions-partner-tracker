const { z } = require("zod");

// Who's currently on furlough or about to be, across every missionary.
// Missionary-only -- organizations have no Furlough relation (see the
// model comment in schema.prisma: "organizations don't go on furlough").
//
// "Current or upcoming" is read directly off the two date columns rather
// than a stored status, same reasoning as oneTimeNeeds deriving pending/
// decided from approvedDate: a furlough with no endDate (ongoing) or an
// endDate that hasn't passed yet qualifies, which covers both a furlough
// already underway and one with a future startDate -- excluding only
// furloughs that are fully in the past.
//
// from/to filter on startDate specifically -- "when does this furlough
// begin" is the question a Quick Range of This Year/Next Year is actually
// answering, same as Status splits on startDate vs today below.
module.exports = {
  id: "furlough",
  label: "Furlough",
  description: "Missionaries currently on furlough or with an upcoming furlough on file.",

  params: z.object({
    // "current" and "upcoming" are the only two states a row here can be
    // in (the query itself excludes anything fully in the past), so this
    // just lets that existing split be filtered on instead of only
    // displayed.
    status: z.enum(["all", "current", "upcoming"]).default("all"),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  fields: [
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "current", label: "Current" },
        { value: "upcoming", label: "Upcoming" },
      ],
    },
    {
      // Looks forward, not back -- "when's the next person leaving"
      // matters more here than a past month/year, so this offers This
      // Year/Next Year rather than prayerRequests/oneTimeNeeds' This
      // Month/This Year/Last Year.
      name: "quickRange",
      label: "Quick Range",
      type: "dateRangePreset",
      appliesTo: { from: "from", to: "to" },
      options: [
        { value: "all", label: "All Time" },
        { value: "year", label: "This Year" },
        { value: "nextYear", label: "Next Year" },
      ],
    },
    { name: "from", label: "Starting on or after", type: "date" },
    { name: "to", label: "Starting on or before", type: "date" },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],

  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "field", label: "Field" },
    { key: "status", label: "Status" },
    { key: "startDate", label: "Start", type: "date" },
    { key: "endDate", label: "End", type: "date" },
    { key: "notes", label: "Notes" },
  ],

  async run(params, prisma) {
    const today = new Date(new Date().toISOString().slice(0, 10));

    const partners = await prisma.partner.findMany({
      where: {
        kind: "missionary",
        ...(params.includeArchived ? {} : { archived: false }),
        furloughs: { some: { OR: [{ endDate: null }, { endDate: { gte: today } }] } },
      },
      select: {
        id: true,
        displayName: true,
        fieldDisplayName: true,
        furloughs: {
          where: { OR: [{ endDate: null }, { endDate: { gte: today } }] },
          orderBy: { startDate: "asc" },
        },
      },
    });

    return partners
      .flatMap((p) =>
        p.furloughs.map((f) => ({
          id: f.id,
          partnerId: p.id,
          partnerName: p.displayName,
          field: p.fieldDisplayName,
          status: new Date(f.startDate) <= today ? "Current" : "Upcoming",
          startDate: f.startDate,
          endDate: f.endDate,
          notes: f.notes,
        }))
      )
      .filter((f) => params.status === "all" || f.status.toLowerCase() === params.status)
      .filter((f) => !params.from || new Date(f.startDate) >= params.from)
      .filter((f) => !params.to || new Date(f.startDate) <= params.to);
  },
};
