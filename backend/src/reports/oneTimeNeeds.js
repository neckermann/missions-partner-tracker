const { z } = require("zod");

// One-time gift requests over a date range, with what was decided.
//
// This is the board/committee shape from issue #22: what was asked for, what
// was approved, and what is still waiting on a decision, in a form you can
// put in front of a meeting.
//
// SupportNeed has no status column -- "decided" is approvedDate being set
// (see the model in schema.prisma). The filter below derives it rather than
// inventing a column, so this report can't disagree with the One-Time Needs
// page about what "pending" means.
module.exports = {
  id: "one-time-needs",
  label: "One-Time Needs",
  description:
    "One-time gift requests in a date range, showing requested and approved amounts and what is still pending.",

  params: z.object({
    // Date-only strings. Left open-ended if omitted, which is the useful
    // default for "everything still outstanding".
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    status: z.enum(["all", "pending", "decided"]).default("all"),
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  fields: [
    { name: "from", label: "Requested on or after", type: "date" },
    { name: "to", label: "Requested on or before", type: "date" },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "pending", label: "Pending a decision" },
        { value: "decided", label: "Decided" },
      ],
    },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],

  // `type` is a rendering hint for the table only -- the CSV carries raw
  // integers and ISO dates so a spreadsheet can sum and sort them.
  columns: [
    { key: "requestDate", label: "Requested", type: "date" },
    { key: "partnerName", label: "Partner" },
    { key: "description", label: "Need" },
    { key: "requestedAmount", label: "Requested ($)", type: "currency" },
    { key: "approvedAmount", label: "Approved ($)", type: "currency" },
    { key: "approvedDate", label: "Decided", type: "date" },
    { key: "status", label: "Status" },
  ],

  async run(params, prisma) {
    const where = {};

    if (params.from || params.to) {
      where.requestDate = {};
      if (params.from) where.requestDate.gte = params.from;
      if (params.to) where.requestDate.lte = params.to;
    }

    // Derived, not stored -- see the note above.
    if (params.status === "pending") where.approvedDate = null;
    if (params.status === "decided") where.approvedDate = { not: null };

    if (!params.includeArchived) where.partner = { archived: false };

    const records = await prisma.supportNeed.findMany({
      where,
      select: {
        id: true,
        description: true,
        requestedAmount: true,
        requestDate: true,
        approvedAmount: true,
        approvedDate: true,
        partner: { select: { id: true, displayName: true, archived: true } },
      },
      orderBy: [{ requestDate: "desc" }],
    });

    return records.map((r) => ({
      id: r.id,
      requestDate: r.requestDate,
      partnerId: r.partner.id,
      partnerName: r.partner.displayName,
      description: r.description,
      requestedAmount: r.requestedAmount,
      // Blank rather than 0 when undecided -- a zero here would read as
      // "approved for nothing", which is a different thing from "not yet
      // looked at".
      approvedAmount: r.approvedDate ? r.approvedAmount : null,
      approvedDate: r.approvedDate,
      status: r.approvedDate ? "Decided" : "Pending",
      archived: Boolean(r.partner.archived),
    }));
  },
};
