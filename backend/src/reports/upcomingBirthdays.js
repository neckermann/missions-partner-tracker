const { z } = require("zod");
const { birthdaysInMonth } = require("../utils/birthdays");

// Who has a birthday in a given calendar month.
//
// Calendar months rather than a rolling "next 30 days" window: it is how a
// church office actually plans -- you think in Novembers, not in rolling
// thirties -- and it removes two whole classes of bug for free. A rolling
// window has to handle the year wrapping (28 Dec -> 5 Jan) and has to decide
// what to do with 29 February in a non-leap year. Grouping by month means a
// 29 February birthday simply sits in February and nothing wraps.
//
// The month comes from the caller, not from the server's clock: no church
// timezone is stored anywhere (verified against ChurchSettings), so the
// browser is the only thing here that knows what month it is where the user
// is standing.
module.exports = {
  id: "upcoming-birthdays",
  label: "Upcoming Birthdays",
  description: "Adults and children with a birthday in the selected month, with the partner they belong to.",

  params: z.object({
    month: z.coerce.number().int().min(1).max(12),
    // The year the ages are counted against. Supplied by the browser for the
    // same reason as the month.
    year: z.coerce.number().int().min(1900).max(2200).optional(),
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  // What the filter form renders. Kept alongside `params` by hand rather
  // than reflected out of it -- see the note in reports/index.js.
  fields: [
    { name: "month", label: "Month", type: "month" },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],

  // Drives the table and the CSV header, so the two cannot disagree.
  // `type` is a rendering hint for the table only -- the CSV always carries
  // the raw value, so a spreadsheet gets a real number and an ISO date
  // rather than "$1,000" and "5 November" as text.
  columns: [
    { key: "day", label: "Day", type: "monthDay" },
    { key: "name", label: "Name" },
    { key: "personTypeLabel", label: "Adult/Child" },
    { key: "turning", label: "Turning" },
    { key: "partnerName", label: "Partner" },
    { key: "field", label: "Field" },
  ],

  async run(params, prisma) {
    const partners = await prisma.partner.findMany({
      where: params.includeArchived ? {} : { archived: false },
      select: {
        id: true,
        displayName: true,
        fieldDisplayName: true,
        archived: true,
        // Names and birthdays only. No phone or email: the report has no use
        // for them and there is no reason to carry contact details through a
        // path that ends in a downloadable file.
        adults: { select: { id: true, name: true, birthday: true } },
        children: { select: { id: true, name: true, birthday: true } },
      },
    });

    const rows = birthdaysInMonth(partners, params.month, {
      inYear: params.year ?? new Date().getFullYear(),
    });

    return rows.map((r) => ({
      ...r,
      personTypeLabel: r.personType === "child" ? "Child" : "Adult",
    }));
  },
};
