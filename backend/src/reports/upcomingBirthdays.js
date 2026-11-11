const { z } = require("zod");
const { birthdaysInMonth } = require("../utils/birthdays");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Who has a birthday in a given calendar month, or across the whole year.
//
// Calendar months rather than a rolling "next 30 days" window: it is how a
// church office actually plans -- you think in Novembers, not in rolling
// thirties -- and it removes two whole classes of bug for free. A rolling
// window has to handle the year wrapping (28 Dec -> 5 Jan) and has to decide
// what to do with 29 February in a non-leap year. Grouping by month means a
// 29 February birthday simply sits in February and nothing wraps.
//
// The month/year are optional in month view now -- `ChurchSettings.timezone`
// means the server knows what day it is where the church actually is (see
// `run()`'s use of the `today` param below), so an unsupplied month/year
// defaults to the current one there rather than requiring the browser to
// supply it. The browser can still send its own, and does by default (see
// AdminReports.jsx) -- that's a real human looking at a specific month, not
// just "whatever month it is," and takes precedence when present.
//
// Defaults to the full-year view, not the current month: a church office
// planning ahead ("who do we need cards for this year") is the more common
// need than "just this month" -- the single-month view is still there for
// whoever wants it, just not the first thing shown.
module.exports = {
  id: "upcoming-birthdays",
  label: "Upcoming Birthdays",
  description:
    "Adults and children with a birthday in the selected month, or across the whole year, with the partner they belong to.",

  params: z.object({
    view: z.enum(["year", "month"]).default("year"),
    // Optional even in month view -- defaults to the current month in the
    // church's configured timezone when absent (see `run()` below). A
    // year-view run never reads it either way.
    month: z.coerce.number().int().min(1).max(12).optional(),
    // The year the ages are counted against. Defaults the same way as month
    // when the browser doesn't supply one.
    year: z.coerce.number().int().min(1900).max(2200).optional(),
    includeArchived: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .transform((v) => v === true || v === "true")
      .default(false),
  }),

  // What the filter form renders. Kept alongside `params` by hand rather
  // than reflected out of it -- see the note in reports/index.js. `month`
  // declares `showWhen` so the generic filter form hides it unless `view`
  // is set to "month" -- it would otherwise be a dead control with no
  // effect on a year-view run.
  fields: [
    {
      name: "view",
      label: "View",
      type: "select",
      options: [
        { value: "year", label: "Full year" },
        { value: "month", label: "One month" },
      ],
    },
    { name: "month", label: "Month", type: "month", showWhen: { field: "view", equals: "month" } },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],

  // Drives the table and the CSV header, so the two cannot disagree.
  // `type` is a rendering hint for the table only -- the CSV always carries
  // the raw value, so a spreadsheet gets a real number and an ISO date
  // rather than "$1,000" and "5 November" as text.
  columns: [
    { key: "monthLabel", label: "Month" },
    { key: "day", label: "Day", type: "monthDay" },
    { key: "name", label: "Name" },
    { key: "personTypeLabel", label: "Adult/Child" },
    { key: "turning", label: "Turning", type: "number" },
    { key: "partnerName", label: "Partner" },
    { key: "field", label: "Field" },
  ],

  async run(params, prisma, today) {
    const partners = await prisma.partner.findMany({
      where: params.includeArchived ? {} : { archived: false },
      select: {
        id: true,
        displayName: true,
        fieldDisplayName: true,
        // Names and birthdays only. No phone or email: the report has no use
        // for them and there is no reason to carry contact details through a
        // path that ends in a downloadable file.
        adults: { select: { id: true, name: true, birthday: true } },
        children: { select: { id: true, name: true, birthday: true } },
      },
    });

    // getUTCFullYear, not getFullYear: `today` is a calendar day encoded as
    // UTC midnight (see reports/index.js's header comment), same shape as
    // any other date-only value -- reading it with a local getter here
    // would be the exact bug this app keeps fixing, just relocated to this
    // file instead of eliminated.
    const inYear = params.year ?? today.getUTCFullYear();
    // Looping months 1-12 and concatenating in order, rather than a
    // separate "whole year" query, keeps birthdaysInMonth as the one place
    // that does the month/day extraction -- a year view is just every
    // month's result laid end to end, already sorted day-then-name within
    // each month, so the concatenation is already month-then-day overall
    // without a second sort pass.
    const months =
      params.view === "month" ? [params.month ?? today.getUTCMonth() + 1] : Array.from({ length: 12 }, (_, i) => i + 1);
    const rows = months.flatMap((month) => birthdaysInMonth(partners, month, { inYear }));

    return rows.map((r) => ({
      ...r,
      personTypeLabel: r.personType === "child" ? "Child" : "Adult",
      monthLabel: MONTH_NAMES[r.month - 1],
    }));
  },
};
