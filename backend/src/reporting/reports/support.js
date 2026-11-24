// Money: committed support. A partner's support is a ledger of monthly
// pledges (SupportEntry), so every number here is what the church has
// COMMITTED, not gifts actually sent -- see reporting/definitions.js.
const { z } = require("zod");
const {
  optionalDay,
  flag,
  oneOf,
  ymd,
  KIND_VALUES,
  sendingChurchParam,
  sendingChurchField,
} = require("../params");
const { sendingChurchPartnerWhere } = require("../../utils/sendingChurch");
const { monthlySupportAsOf, supportEntryAsOf, supportChange, toUtcDay } = require("../definitions");

const partnerSelect = {
  id: true,
  displayName: true,
  kind: true,
  isRestricted: true,
  addresses: { select: { country: true, type: true } },
  supportEntries: { select: { amount: true, effectiveDate: true, createdAt: true } },
};

function whereFor(params) {
  const where = {};
  if (!params.includeArchived) where.archived = false;
  if (params.kind !== "all") where.kind = params.kind;
  Object.assign(where, sendingChurchPartnerWhere(params.sendingChurch) || {});
  return where;
}

function countryOf(partner) {
  const withCountry = (partner.addresses || []).filter((a) => a.country);
  const physical = withCountry.find((a) => a.type === "physical");
  return (physical || withCountry[0])?.country || "Unknown";
}

const filterFields = [
  { name: "kind", label: "Partner type", type: "select", options: KIND_VALUES },
  sendingChurchField,
  { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
];

const supportSummary = {
  id: "support-summary",
  group: "money",
  label: "Support summary",
  question: "What monthly support has the church committed, and to whom?",
  requiresFeature: "monthlySupport",
  params: z.object({
    asOf: optionalDay,
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
    includeZero: flag(false),
  }),
  fields: [
    { name: "asOf", label: "As of", type: "date" },
    ...filterFields,
    { name: "includeZero", label: "Include partners with no current support", type: "checkbox" },
  ],
  chart: {
    kind: "bar",
    label: "partnerName",
    value: "monthly",
    type: "currency",
    title: "Top partners by committed monthly support",
    limit: 10,
  },
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "kind", label: "Type" },
    { key: "country", label: "Country" },
    { key: "monthly", label: "Monthly ($)", type: "currency" },
    { key: "since", label: "Current amount since", type: "date" },
  ],
  fetch: (params, { prisma }) => prisma.partner.findMany({ where: whereFor(params), select: partnerSelect }),
  compute(partners, params, { today }) {
    const asOf = params.asOf || today;
    const rows = [];
    for (const p of partners) {
      const monthly = monthlySupportAsOf(p.supportEntries, asOf);
      if (monthly === 0 && !params.includeZero) continue;
      const entry = supportEntryAsOf(p.supportEntries, asOf);
      rows.push({
        partnerName: p.displayName,
        kind: p.kind,
        country: countryOf(p),
        monthly,
        since: entry ? ymd(entry.effectiveDate) : null,
        _restricted: p.isRestricted,
      });
    }
    rows.sort((a, b) => b.monthly - a.monthly || a.partnerName.localeCompare(b.partnerName));
    const total = rows.reduce((s, r) => s + r.monthly, 0);
    const top5 = rows.slice(0, 5).reduce((s, r) => s + r.monthly, 0);
    return {
      rows,
      summary: [
        { label: "Partners supported", value: rows.filter((r) => r.monthly > 0).length },
        { label: "Committed per month", value: total, type: "currency" },
        { label: "Annualized", value: total * 12, type: "currency" },
        { label: "Top 5 share", value: total ? `${Math.round((top5 / total) * 100)}%` : "—" },
      ],
      notes: [
        `As of ${ymd(asOf)}. Amounts are the monthly support the church has committed (each partner's latest entry on or before that day), not gifts received.`,
      ],
    };
  },
};

const supportChanges = {
  id: "support-changes",
  group: "money",
  label: "Support changes",
  question: "Whose support is new, up, down or ended in a period?",
  requiresFeature: "monthlySupport",
  params: z.object({
    from: optionalDay,
    to: optionalDay,
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [
    { name: "from", label: "From", type: "date" },
    { name: "to", label: "To", type: "date" },
    ...filterFields,
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "change", label: "Change" },
    { key: "before", label: "Before ($/mo)", type: "currency" },
    { key: "after", label: "After ($/mo)", type: "currency" },
    { key: "delta", label: "Difference ($/mo)", type: "currency" },
  ],
  fetch: (params, { prisma }) => prisma.partner.findMany({ where: whereFor(params), select: partnerSelect }),
  compute(partners, params, { today }) {
    const to = params.to || today;
    const from = params.from || new Date(Date.UTC(toUtcDay(to).getUTCFullYear(), 0, 1));
    const rows = [];
    const counts = { new: 0, increase: 0, decrease: 0, ended: 0 };
    let net = 0;
    for (const p of partners) {
      const c = supportChange(p.supportEntries, from, to);
      if (c.type === "unchanged") continue;
      counts[c.type] += 1;
      net += c.delta;
      if (params.change !== "all" && c.type !== params.change) continue;
      rows.push({
        partnerName: p.displayName,
        change: c.type,
        before: c.before,
        after: c.after,
        delta: c.delta,
        _restricted: p.isRestricted,
      });
    }
    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.partnerName.localeCompare(b.partnerName));
    return {
      rows,
      summary: [
        { label: "New", value: counts.new, filter: { change: "new" } },
        { label: "Increased", value: counts.increase, filter: { change: "increase" } },
        { label: "Decreased", value: counts.decrease, filter: { change: "decrease" } },
        { label: "Ended", value: counts.ended, filter: { change: "ended" } },
        { label: "Net change per month", value: net, type: "currency" },
      ],
      notes: [`Compares monthly support in force the day before ${ymd(from)} with ${ymd(to)}.`],
    };
  },
};

module.exports = { reports: [supportSummary, supportChanges], countryOf };
