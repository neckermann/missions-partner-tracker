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
module.exports = {
  id: "furlough",
  label: "Furlough",
  description: "Missionaries currently on furlough or with an upcoming furlough on file.",

  params: z.object({
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  fields: [{ name: "includeArchived", label: "Include archived partners", type: "checkbox" }],

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

    return partners.flatMap((p) =>
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
    );
  },
};
