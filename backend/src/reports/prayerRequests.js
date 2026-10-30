const { z } = require("zod");

// Prayer requests across every partner, filterable by category, status and
// date range -- the shape a prayer team or board asks for: what's still
// open, what's been answered, grouped by partner.
module.exports = {
  id: "prayer-requests",
  requiresFeature: "prayerRequests",
  label: "Prayer Requests",
  description: "Prayer requests across every partner, with status and when they were received.",

  params: z.object({
    category: z.enum(["all", "strategic", "situational"]).default("all"),
    status: z.enum(["all", "ongoing", "answered", "untracked"]).default("all"),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  fields: [
    {
      name: "category",
      label: "Category",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "strategic", label: "Strategic" },
        { value: "situational", label: "Situational" },
      ],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "ongoing", label: "Ongoing" },
        { value: "answered", label: "Answered" },
        { value: "untracked", label: "Untracked" },
      ],
    },
    { name: "from", label: "Received on or after", type: "date" },
    { name: "to", label: "Received on or before", type: "date" },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],

  columns: [
    { key: "dateReceived", label: "Received", type: "date" },
    { key: "partnerName", label: "Partner" },
    { key: "category", label: "Category" },
    { key: "requestText", label: "Request" },
    { key: "status", label: "Status" },
    { key: "dateAnswered", label: "Answered", type: "date" },
  ],

  async run(params, prisma) {
    const where = {};
    if (params.category !== "all") where.category = params.category;
    if (params.status !== "all") where.status = params.status;
    if (params.from || params.to) {
      where.dateReceived = {};
      if (params.from) where.dateReceived.gte = params.from;
      if (params.to) where.dateReceived.lte = params.to;
    }
    if (!params.includeArchived) where.partner = { archived: false };

    const records = await prisma.prayerRequest.findMany({
      where,
      select: {
        id: true,
        category: true,
        requestText: true,
        dateReceived: true,
        status: true,
        dateAnswered: true,
        partner: { select: { id: true, displayName: true, archived: true } },
      },
      orderBy: [{ dateReceived: "desc" }],
    });

    return records.map((r) => ({
      id: r.id,
      dateReceived: r.dateReceived,
      partnerId: r.partner.id,
      partnerName: r.partner.displayName,
      category: r.category === "strategic" ? "Strategic" : "Situational",
      requestText: r.requestText,
      status: r.status[0].toUpperCase() + r.status.slice(1),
      dateAnswered: r.dateAnswered,
      archived: Boolean(r.partner.archived),
    }));
  },
};
