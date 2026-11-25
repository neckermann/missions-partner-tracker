// The report catalog. Each module in ./reports exports `reports`, an array of
// { id, group, label, question, params, fields, columns, fetch, compute }. Add a
// report there and the route and frontend pick it up.
const { applyMasking } = require("./masking");

const GROUPS = [
  {
    key: "money",
    label: "Money",
    icon: "💵",
    description: "Committed monthly support and how it is changing.",
  },
  {
    key: "care",
    label: "Partner care",
    icon: "🙏",
    description: "Prayer, one-time needs and the health of partner records.",
  },
  {
    key: "people",
    label: "Partners & relationships",
    icon: "🤝",
    description: "Who we support, for how long, and who has gone quiet.",
  },
  { key: "upcoming", label: "Upcoming", icon: "🎂", description: "Birthdays and anniversaries coming up." },
  { key: "trips", label: "Trips", icon: "✈️", description: "Fundraising and readiness for upcoming trips." },
  {
    key: "coverage",
    label: "Coverage",
    icon: "🌍",
    description: "Where we serve and which languages we reach.",
  },
  {
    key: "communication",
    label: "Communication",
    icon: "📨",
    description: "Whether sends and applications are flowing.",
  },
  { key: "contacts", label: "Contacts", icon: "📬", description: "Who gets mail and packages, and where." },
  { key: "system", label: "System", icon: "⚙️", description: "Who can sign in and how they are protected." },
];

const ALL = [
  ...require("./reports/support").reports,
  ...require("./reports/care").reports,
  ...require("./reports/trips").reports,
  ...require("./reports/people").reports,
  ...require("./reports/partners").reports,
  ...require("./reports/communication").reports,
];

const DEFAULT_ROLES = ["admin", "editor", "viewer"];

function allowed(report, role, isEnabled) {
  if (!(report.roles || DEFAULT_ROLES).includes(role)) return false;
  return !report.requiresFeature || isEnabled(report.requiresFeature);
}

// Catalog for the hub: metadata only, no data.
function listReports({ role, isEnabled }) {
  const reports = ALL.filter((r) => allowed(r, role, isEnabled)).map((r) => ({
    id: r.id,
    group: r.group,
    label: r.label,
    question: r.question,
    fields: r.fields,
    columns: r.columns,
  }));
  const groups = GROUPS.filter((g) => reports.some((r) => r.group === g.key));
  return { groups, reports };
}

function getReport(id, { role, isEnabled }) {
  const report = ALL.find((r) => r.id === id);
  return report && allowed(report, role, isEnabled) ? report : null;
}

// Parse, fetch, compute, then mask in one place. `audience` is "admin" for the
// signed-in app; anything leaving it must pass "shared" with `settings` (decides
// whether a restricted partner's masked name is initials or a generic label).
async function runReport(report, query, { prisma, today, audience = "admin", settings }) {
  const params = report.params.parse(query);
  const data = await report.fetch(params, { prisma, today });
  const result = report.compute(data, params, { today });
  return {
    columns: report.columns,
    rows: applyMasking(result.rows, report.columns, audience, settings),
    summary: result.summary || [],
    chart: report.chart || null,
    notes: result.notes || [],
  };
}

module.exports = { GROUPS, listReports, getReport, runReport };
