// Partner relationships and coverage: key dates, languages, where we serve,
// roster, and how recently we've heard from each partner.
const { z } = require("zod");
const { optionalDay, flag, oneOf, positiveInt, ymd, KIND_VALUES } = require("../params");
const { nextAnnual, daysBetween, monthlySupportAsOf } = require("../definitions");
const { countryOf } = require("./support");

const kindOptions = KIND_VALUES.map((v) => ({ value: v, label: v === "all" ? "All" : v }));
const baseWhere = (p) => ({
  ...(p.includeArchived ? {} : { archived: false }),
  ...(p.kind && p.kind !== "all" ? { kind: p.kind } : {}),
});
const archivedField = { name: "includeArchived", label: "Include archived partners", type: "checkbox" };
const kindField = { name: "kind", label: "Partner type", type: "select", options: kindOptions };
const person = (a) => [a.firstName, a.lastName].filter(Boolean).join(" ") || "Family member";

const keyDates = {
  id: "key-dates",
  group: "upcoming",
  label: "Families & key dates",
  question: "Whose birthday or anniversary is coming up?",
  params: z.object({
    days: positiveInt(30, 366),
    kind: oneOf(KIND_VALUES, "all"),
    includeArchived: flag(false),
  }),
  fields: [{ name: "days", label: "Look ahead (days)", type: "number" }, kindField, archivedField],
  columns: [
    { key: "date", label: "Date", type: "date" },
    { key: "daysUntil", label: "In (days)", type: "number" },
    { key: "partnerName", label: "Partner" },
    { key: "who", label: "Who", sensitive: true },
    { key: "occasion", label: "Occasion" },
    { key: "turning", label: "Turning / years", type: "number", sensitive: true },
  ],
  fetch: (params, { prisma }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        displayName: true,
        isRestricted: true,
        anniversary: true,
        adults: { select: { firstName: true, lastName: true, birthday: true } },
        children: { select: { firstName: true, lastName: true, birthday: true } },
      },
    }),
  compute(partners, params, { today }) {
    const rows = [];
    const add = (p, date, who, occasion, includeYears) => {
      if (!date) return;
      const n = nextAnnual(date, today);
      if (n.daysUntil > params.days) return;
      rows.push({
        date: ymd(n.next),
        daysUntil: n.daysUntil,
        partnerName: p.displayName,
        who,
        occasion,
        turning: includeYears ? n.years : null,
        _restricted: p.isRestricted,
      });
    };
    for (const p of partners) {
      p.adults.forEach((a) => add(p, a.birthday, person(a), "Birthday", true));
      p.children.forEach((c) => add(p, c.birthday, person(c), "Birthday (child)", true));
      add(p, p.anniversary, "", "Anniversary", true);
    }
    rows.sort((a, b) => a.daysUntil - b.daysUntil || a.partnerName.localeCompare(b.partnerName));
    return {
      rows,
      summary: [
        { label: "Coming up", value: rows.length },
        { label: "Within 7 days", value: rows.filter((r) => r.daysUntil <= 7).length },
      ],
      notes: ["Birth years entered as placeholders will show a misleading age; check the family record."],
    };
  },
};

const languageCoverage = {
  id: "language-coverage",
  group: "coverage",
  label: "Language coverage",
  question: "Which languages do our partners speak, and who has none recorded?",
  params: z.object({ kind: oneOf(KIND_VALUES, "all"), includeArchived: flag(false) }),
  fields: [kindField, archivedField],
  chart: { kind: "bar", label: "language", value: "partners", title: "Partners by language", limit: 10 },
  columns: [
    { key: "language", label: "Language" },
    { key: "partners", label: "Partners", type: "number" },
    { key: "names", label: "Who" },
  ],
  fetch: (params, { prisma }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        displayName: true,
        isRestricted: true,
        languages: { select: { language: true, proficiency: true } },
      },
    }),
  compute(partners) {
    const nameList = (names) => {
      const shown = names.filter(Boolean).sort();
      const hidden = names.length - shown.length;
      return hidden ? [...shown, `${hidden} restricted`].join(", ") : shown.join(", ");
    };
    const byLang = new Map();
    const none = [];
    for (const p of partners) {
      // Restricted partners are counted but never named: this row is an
      // aggregate, so the central per-row masking cannot cover it.
      const label = p.isRestricted ? null : p.displayName;
      if (p.languages.length === 0) none.push(label);
      for (const l of p.languages) {
        const key = l.language.trim() || "Unspecified";
        if (!byLang.has(key)) byLang.set(key, []);
        byLang.get(key).push(label);
      }
    }
    const rows = [...byLang.entries()]
      .map(([language, names]) => ({ language, partners: names.length, names: nameList(names) }))
      .sort((a, b) => b.partners - a.partners || a.language.localeCompare(b.language));
    if (none.length) rows.push({ language: "(none recorded)", partners: none.length, names: nameList(none) });
    return {
      rows,
      summary: [
        { label: "Languages", value: byLang.size },
        { label: "Partners with no language", value: none.length },
      ],
      notes: ["Restricted partners are counted but not named."],
    };
  },
};

const whereWeServe = {
  id: "where-we-serve",
  group: "coverage",
  label: "Where we serve",
  question: "Which countries are our partners in, and how much support goes where?",
  requiresFeature: null,
  params: z.object({ asOf: optionalDay, kind: oneOf(KIND_VALUES, "all"), includeArchived: flag(false) }),
  fields: [{ name: "asOf", label: "As of", type: "date" }, kindField, archivedField],
  chart: {
    kind: "bar",
    label: "country",
    value: "monthly",
    type: "currency",
    title: "Committed monthly support by country",
    limit: 10,
  },
  columns: [
    { key: "country", label: "Country" },
    { key: "partners", label: "Partners", type: "number" },
    { key: "monthly", label: "Committed ($/mo)", type: "currency" },
    { key: "share", label: "Share of support (%)", type: "number" },
  ],
  fetch: (params, { prisma }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        addresses: { select: { country: true, type: true } },
        supportEntries: { select: { amount: true, effectiveDate: true, createdAt: true } },
      },
    }),
  compute(partners, params, { today }) {
    const asOf = params.asOf || today;
    const map = new Map();
    for (const p of partners) {
      const c = countryOf(p);
      const row = map.get(c) || { country: c, partners: 0, monthly: 0 };
      row.partners += 1;
      row.monthly += monthlySupportAsOf(p.supportEntries, asOf);
      map.set(c, row);
    }
    const rows = [...map.values()];
    const total = rows.reduce((s, r) => s + r.monthly, 0);
    rows.forEach((r) => (r.share = total ? Math.round((r.monthly / total) * 100) : 0));
    rows.sort(
      (a, b) => b.monthly - a.monthly || b.partners - a.partners || a.country.localeCompare(b.country)
    );
    return {
      rows,
      summary: [
        { label: "Countries", value: rows.filter((r) => r.country !== "Unknown").length },
        { label: "Partners", value: partners.length },
        { label: "Committed per month", value: total, type: "currency" },
      ],
      notes: [
        "A partner is counted in the country of its physical address (or its first address). 'Unknown' means no address.",
      ],
    };
  },
};

const partnerRoster = {
  id: "partner-roster",
  group: "people",
  label: "Partner roster & tenure",
  question: "Who do we support, and for how long?",
  params: z.object({ asOf: optionalDay, kind: oneOf(KIND_VALUES, "all"), includeArchived: flag(false) }),
  fields: [{ name: "asOf", label: "As of", type: "date" }, kindField, archivedField],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "kind", label: "Type" },
    { key: "country", label: "Country" },
    { key: "since", label: "Supporting since", type: "date" },
    { key: "years", label: "Years", type: "number" },
    { key: "sentByUs", label: "Sent by us" },
    { key: "monthly", label: "Committed ($/mo)", type: "currency" },
    { key: "status", label: "Status" },
  ],
  fetch: (params, { prisma }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        displayName: true,
        kind: true,
        isRestricted: true,
        archived: true,
        supportingSince: true,
        sentByOurChurch: true,
        addresses: { select: { country: true, type: true } },
        supportEntries: { select: { amount: true, effectiveDate: true, createdAt: true } },
      },
    }),
  compute(partners, params, { today }) {
    const asOf = params.asOf || today;
    const rows = partners.map((p) => ({
      partnerName: p.displayName,
      kind: p.kind,
      country: countryOf(p),
      since: ymd(p.supportingSince),
      years: p.supportingSince ? Math.floor(daysBetween(asOf, p.supportingSince) / 365.25) : null,
      sentByUs: p.sentByOurChurch ? "Yes" : "",
      monthly: monthlySupportAsOf(p.supportEntries, asOf),
      status: p.archived ? "Archived" : "Active",
      _restricted: p.isRestricted,
    }));
    rows.sort((a, b) => (b.years ?? -1) - (a.years ?? -1) || a.partnerName.localeCompare(b.partnerName));
    return {
      rows,
      summary: [
        { label: "Partners", value: rows.length },
        { label: "Sent by us", value: rows.filter((r) => r.sentByUs).length },
        { label: "Over 10 years", value: rows.filter((r) => (r.years ?? 0) >= 10).length },
      ],
      notes: [],
    };
  },
};

const lastHeardFrom = {
  id: "last-heard-from",
  group: "people",
  label: "Last heard from",
  question: "Which partners have gone quiet?",
  params: z.object({
    asOf: optionalDay,
    staleDays: positiveInt(90, 3650),
    onlyStale: flag(true),
    kind: oneOf(KIND_VALUES, "all"),
    includeArchived: flag(false),
  }),
  fields: [
    { name: "asOf", label: "As of", type: "date" },
    { name: "staleDays", label: "Quiet for at least (days)", type: "number" },
    { name: "onlyStale", label: "Only quiet partners", type: "checkbox" },
    kindField,
    archivedField,
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "newsletter", label: "Last newsletter", type: "date" },
    { key: "newsletterDays", label: "Days ago", type: "number" },
    { key: "photo", label: "Last photo", type: "date" },
    { key: "prayer", label: "Last prayer request", type: "date" },
    { key: "visit", label: "Last church visit", type: "date" },
  ],
  fetch: (params, { prisma }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        displayName: true,
        isRestricted: true,
        files: { where: { kind: "newsletter" }, select: { receivedDate: true } },
        photos: { select: { receivedDate: true } },
        prayerRequests: { select: { dateReceived: true } },
        churchVisits: { select: { visitDate: true } },
      },
    }),
  compute(partners, params, { today }) {
    const asOf = params.asOf || today;
    const latest = (list, key) => list.reduce((m, x) => (!m || x[key] > m ? x[key] : m), null);
    const rows = [];
    for (const p of partners) {
      const newsletter = latest(p.files, "receivedDate");
      const days = newsletter ? daysBetween(asOf, newsletter) : null;
      const stale = days === null || days >= params.staleDays;
      if (params.onlyStale && !stale) continue;
      rows.push({
        partnerName: p.displayName,
        newsletter: ymd(newsletter),
        newsletterDays: days,
        photo: ymd(latest(p.photos, "receivedDate")),
        prayer: ymd(latest(p.prayerRequests, "dateReceived")),
        visit: ymd(latest(p.churchVisits, "visitDate")),
        _restricted: p.isRestricted,
      });
    }
    rows.sort(
      (a, b) =>
        (b.newsletterDays ?? 99999) - (a.newsletterDays ?? 99999) ||
        a.partnerName.localeCompare(b.partnerName)
    );
    return {
      rows,
      summary: [
        {
          label: "Quiet partners",
          value: rows.filter((r) => r.newsletterDays === null || r.newsletterDays >= params.staleDays).length,
        },
        { label: "Never sent a newsletter", value: rows.filter((r) => r.newsletterDays === null).length },
      ],
      notes: ["'Quiet' is measured by the most recent newsletter file on record."],
    };
  },
};

module.exports = { reports: [keyDates, languageCoverage, whereWeServe, partnerRoster, lastHeardFrom] };
