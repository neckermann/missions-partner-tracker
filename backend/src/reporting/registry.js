// The report catalog. Each module in ./reports exports `reports`, an array of
// { id, group, label, question, params, fields, columns, fetch, compute }. Add a
// report there and the route and frontend pick it up.
const { MASK_NAME_SELECT, restrictedInitials } = require("../utils/maskData");
const { applyMasking } = require("./masking");
const { currencySymbol } = require("../utils/money");
const { isFeatureEnabled } = require("../utils/features");

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

// A report that is itself always available can still carry one column, summary line or chart that belongs to a
// feature (a monthly support amount in "Where we serve"). Marking that piece `requiresFeature` leaves it out of
// the catalog and of every run while the feature is off, for the page, the CSV and the scheduled email alike.
// The report's own fetch/compute get `isEnabled` too, so they neither load nor sort by what is hidden.
const featureFilter = (isEnabled) => (piece) => !piece?.requiresFeature || isEnabled(piece.requiresFeature);
const withoutFeatureKey = ({ requiresFeature: _requiresFeature, ...piece }) => piece;

function shapeFor(report, isEnabled) {
  const keep = featureFilter(isEnabled);
  return {
    question: typeof report.question === "function" ? report.question(isEnabled) : report.question,
    columns: report.columns.filter(keep).map(withoutFeatureKey),
    hiddenKeys: report.columns.filter((c) => !keep(c)).map((c) => c.key),
    chart: report.chart && keep(report.chart) ? withoutFeatureKey(report.chart) : null,
  };
}

function allowed(report, role, isEnabled) {
  if (!(report.roles || DEFAULT_ROLES).includes(role)) return false;
  return !report.requiresFeature || isEnabled(report.requiresFeature);
}

// Catalog for the hub: metadata only, no data.
function listReports({ role, isEnabled }) {
  const reports = ALL.filter((r) => allowed(r, role, isEnabled)).map((r) => {
    const shape = shapeFor(r, isEnabled);
    return {
      id: r.id,
      group: r.group,
      label: r.label,
      question: shape.question,
      fields: r.fields,
      columns: shape.columns,
    };
  });
  const groups = GROUPS.filter((g) => reports.some((r) => r.group === g.key));
  return { groups, reports };
}

function getReport(id, { role, isEnabled }) {
  const report = ALL.find((r) => r.id === id);
  return report && allowed(report, role, isEnabled) ? report : null;
}

// A currency column's heading says "($)" or "($/mo)": swap the "$" for the church's currency symbol. Only
// currency columns, so a "$" anywhere else is left alone.
function localizeColumns(columns, currency) {
  const symbol = currencySymbol(currency);
  if (symbol === "$") return columns;
  return columns.map((c) => (c.type === "currency" ? { ...c, label: c.label.replace(/\$/g, symbol) } : c));
}

// The initials each restricted partner is shown as in a report that leaves the app, keyed by display name (a report
// row carries only the name). Built from the adults' names, here and nowhere else, only for the shared audience and
// only when some row is restricted. Two restricted partners with the very same display name would share the first
// one's initials, which is the safe direction: still initials, never a real name.
async function restrictedInitialsByName(prisma, rows) {
  if (!rows.some((r) => r._restricted)) return new Map();
  const partners = await prisma.partner.findMany({
    where: { isRestricted: true },
    select: { displayName: true, kind: true, ...MASK_NAME_SELECT },
  });
  const byName = new Map();
  for (const p of partners) if (!byName.has(p.displayName)) byName.set(p.displayName, restrictedInitials(p));
  return byName;
}

// Parse, fetch, compute, then mask in one place. `audience` is "admin" for the
// signed-in app; anything leaving it must pass "shared" with `settings` (decides
// whether a restricted partner's masked name is initials or a generic label).
//
// Which features are on is read here, not passed in, so no caller (the page, the CSV download, the scheduled
// email) can run a report without its feature-gated columns being left out.
async function runReport(report, query, { prisma, today, audience = "admin", settings }) {
  const params = report.params.parse(query);
  const church = await prisma.churchSettings?.findUnique({
    where: { id: "singleton" },
    select: { currency: true, enabledFeatures: true },
  });
  const isEnabled = (key) => isFeatureEnabled(church?.enabledFeatures, key);
  const shape = shapeFor(report, isEnabled);
  const data = await report.fetch(params, { prisma, today, isEnabled });
  const result = report.compute(data, params, { today, isEnabled });
  // A report that forgot to leave a hidden column's value out of its rows still must not send it.
  const rows = shape.hiddenKeys.length
    ? result.rows.map((row) => {
        const kept = { ...row };
        for (const key of shape.hiddenKeys) delete kept[key];
        return kept;
      })
    : result.rows;
  // Money columns are written with a "$" in their heading in the definitions; show the church's symbol instead.
  const columns = localizeColumns(shape.columns, church?.currency);
  return {
    columns,
    rows: applyMasking(
      rows,
      columns,
      audience,
      settings,
      audience === "shared" ? await restrictedInitialsByName(prisma, rows) : undefined
    ),
    summary: (result.summary || []).filter(featureFilter(isEnabled)).map(withoutFeatureKey),
    chart: shape.chart,
    notes: result.notes || [],
  };
}

module.exports = { GROUPS, listReports, getReport, runReport };
