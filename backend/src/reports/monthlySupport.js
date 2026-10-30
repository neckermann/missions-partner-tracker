const { z } = require("zod");

// Each partner's *current* monthly support amount -- the most recent
// SupportEntry on file, same definition AdminMonthlySupport.jsx uses (a
// partner's support is a ledger of entries over time; "current" is simply
// the latest one). A partner with no support entry at all doesn't appear,
// same as on that page.
module.exports = {
  id: "monthly-support",
  requiresFeature: "monthlySupport",
  label: "Monthly Support",
  description: "Each partner's current monthly support amount, as of its most recent entry.",

  params: z.object({
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  fields: [{ name: "includeArchived", label: "Include archived partners", type: "checkbox" }],

  // No grand-total row: the report shell renders a plain row list, by
  // design (see reports/index.js) -- a spreadsheet or the print footer is
  // where a column gets summed, not a special case built into the shell
  // for this one report.
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "amount", label: "Current Amount ($)", type: "currency" },
    { key: "effectiveDate", label: "Effective", type: "date" },
  ],

  async run(params, prisma) {
    const partners = await prisma.partner.findMany({
      where: params.includeArchived ? {} : { archived: false },
      select: {
        id: true,
        displayName: true,
        archived: true,
        supportEntries: {
          orderBy: { effectiveDate: "desc" },
          take: 1,
          select: { amount: true, effectiveDate: true },
        },
      },
    });

    return partners
      .filter((p) => p.supportEntries.length)
      .map((p) => ({
        id: p.id,
        partnerId: p.id,
        partnerName: p.displayName,
        amount: p.supportEntries[0].amount,
        effectiveDate: p.supportEntries[0].effectiveDate,
        archived: Boolean(p.archived),
      }))
      .sort((a, b) => b.amount - a.amount);
  },
};
