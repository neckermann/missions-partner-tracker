// Partner relationships and coverage: key dates, languages, where we serve,
// roster, and how recently we've heard from each partner.
const { z } = require("zod");
const { describeAnswer } = require("../../utils/supportOptions");
const { careTimings } = require("../../utils/careSettings");
const {
  optionalDay,
  flag,
  oneOf,
  positiveInt,
  ymd,
  KIND_VALUES,
  sendingChurchParam,
  sendingChurchField,
} = require("../params");
const { sendingChurchPartnerWhere } = require("../../utils/sendingChurch");
const { nextAnnual, daysBetween, monthlySupportAsOf } = require("../definitions");
const { countryOf } = require("./support");
const { isFeatureEnabled } = require("../../utils/features");

const kindOptions = KIND_VALUES.map((v) => ({ value: v, label: v === "all" ? "All" : v }));
const baseWhere = (p) => ({
  ...(p.includeArchived ? {} : { archived: false }),
  ...(p.kind && p.kind !== "all" ? { kind: p.kind } : {}),
  ...(sendingChurchPartnerWhere(p.sendingChurch) || {}),
});
const archivedField = { name: "includeArchived", label: "Include archived partners", type: "checkbox" };
const kindField = { name: "kind", label: "Partner type", type: "select", options: kindOptions };
const SUPPORT_ENTRY_SELECT = { select: { amount: true, effectiveDate: true, createdAt: true } };
const person = (a) => [a.firstName, a.lastName].filter(Boolean).join(" ") || "Family member";

const keyDates = {
  id: "key-dates",
  group: "upcoming",
  label: "Families & key dates",
  question: "Whose birthday or anniversary is coming up?",
  params: z.object({
    days: positiveInt(30, 366),
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [
    { name: "days", label: "Look ahead (days)", type: "number" },
    kindField,
    sendingChurchField,
    archivedField,
  ],
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
  params: z.object({
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [kindField, sendingChurchField, archivedField],
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
  question: (isEnabled) =>
    isEnabled("monthlySupport")
      ? "Which countries are our partners in, and how much support goes where?"
      : "Which countries are our partners in?",
  requiresFeature: null,
  params: z.object({
    asOf: optionalDay,
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [{ name: "asOf", label: "As of", type: "date" }, kindField, sendingChurchField, archivedField],
  chart: {
    kind: "bar",
    label: "country",
    value: "monthly",
    type: "currency",
    title: "Committed monthly support by country",
    limit: 10,
    requiresFeature: "monthlySupport",
  },
  columns: [
    { key: "country", label: "Country" },
    { key: "partners", label: "Partners", type: "number" },
    { key: "monthly", label: "Committed ($/mo)", type: "currency", requiresFeature: "monthlySupport" },
    { key: "share", label: "Share of support (%)", type: "number", requiresFeature: "monthlySupport" },
  ],
  fetch: (params, { prisma, isEnabled = () => true }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        addresses: { select: { country: true, type: true } },
        ...(isEnabled("monthlySupport") ? { supportEntries: SUPPORT_ENTRY_SELECT } : {}),
      },
    }),
  // With Monthly support off the amounts are neither added up nor used to order the countries.
  compute(partners, params, { today, isEnabled = () => true }) {
    const asOf = params.asOf || today;
    const withSupport = isEnabled("monthlySupport");
    const map = new Map();
    for (const p of partners) {
      const c = countryOf(p);
      const row = map.get(c) || { country: c, partners: 0, ...(withSupport ? { monthly: 0 } : {}) };
      row.partners += 1;
      if (withSupport) row.monthly += monthlySupportAsOf(p.supportEntries, asOf);
      map.set(c, row);
    }
    const rows = [...map.values()];
    const total = withSupport ? rows.reduce((s, r) => s + r.monthly, 0) : 0;
    if (withSupport) rows.forEach((r) => (r.share = total ? Math.round((r.monthly / total) * 100) : 0));
    rows.sort(
      (a, b) =>
        (b.monthly || 0) - (a.monthly || 0) || b.partners - a.partners || a.country.localeCompare(b.country)
    );
    return {
      rows,
      summary: [
        { label: "Countries", value: rows.filter((r) => r.country !== "Unknown").length },
        { label: "Partners", value: partners.length },
        {
          label: "Committed per month",
          value: total,
          type: "currency",
          requiresFeature: "monthlySupport",
        },
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
  params: z.object({
    asOf: optionalDay,
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [{ name: "asOf", label: "As of", type: "date" }, kindField, sendingChurchField, archivedField],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "kind", label: "Type" },
    { key: "country", label: "Country" },
    { key: "since", label: "Partnering since", type: "date" },
    { key: "sentByUs", label: "Sent by us" },
    { key: "monthly", label: "Committed ($/mo)", type: "currency", requiresFeature: "monthlySupport" },
    { key: "status", label: "Status" },
  ],
  fetch: (params, { prisma, isEnabled = () => true }) =>
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
        ...(isEnabled("monthlySupport") ? { supportEntries: SUPPORT_ENTRY_SELECT } : {}),
      },
    }),
  compute(partners, params, { today, isEnabled = () => true }) {
    const asOf = params.asOf || today;
    const withSupport = isEnabled("monthlySupport");
    const rows = partners.map((p) => ({
      partnerName: p.displayName,
      kind: p.kind,
      country: countryOf(p),
      since: ymd(p.supportingSince),
      years: p.supportingSince ? Math.floor(daysBetween(asOf, p.supportingSince) / 365.25) : null,
      sentByUs: p.sentByOurChurch ? "Yes" : "",
      ...(withSupport ? { monthly: monthlySupportAsOf(p.supportEntries, asOf) } : {}),
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
    // Blank means the church's own quiet threshold (Settings -> Care Teams, default 90).
    staleDays: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().int().min(1).max(3650).optional()
    ),
    onlyStale: flag(true),
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [
    { name: "asOf", label: "As of", type: "date" },
    { name: "staleDays", label: "Quiet for at least (days; blank = your church's setting)", type: "number" },
    { name: "onlyStale", label: "Only quiet partners", type: "checkbox" },
    kindField,
    archivedField,
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "newsletter", label: "Last newsletter", type: "date" },
    { key: "newsletterDays", label: "Days ago", type: "number" },
    { key: "contact", label: "Last logged contact", type: "date" },
    { key: "contactDays", label: "Days ago (contact)", type: "number" },
    { key: "photo", label: "Last photo", type: "date" },
    { key: "prayer", label: "Last prayer request", type: "date" },
    { key: "visit", label: "Last church visit", type: "date" },
    { key: "lastPrayedWithCongregation", label: "Last prayed w/ congregation", type: "date" },
  ],
  // A newsletter, a received prayer request, a church visit and (when the contact log is on) a
  // logged contact all count as hearing from a partner (hearing in person is hearing); a partner
  // is "quiet" only when ALL are old. Settings are read here because the hub gives
  // fetch/compute no feature state.
  fetch: async (params, { prisma }) => {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true, contactStaleDays: true },
    });
    const defaultStaleDays = (await careTimings(prisma)).contactStaleDays;
    const contactLogOn = isFeatureEnabled(settings?.enabledFeatures, "contactLog");
    const partners = await prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        displayName: true,
        isRestricted: true,
        lastPrayedWithCongregationAt: true,
        files: { where: { kind: "newsletter" }, select: { receivedDate: true } },
        photos: { select: { receivedDate: true } },
        prayerRequests: { select: { dateReceived: true } },
        churchVisits: { select: { visitDate: true } },
        ...(contactLogOn ? { contactLogs: { select: { contactDate: true } } } : {}),
      },
    });
    return { partners, contactLogOn, defaultStaleDays };
  },
  compute({ partners, contactLogOn, defaultStaleDays }, params, { today }) {
    const asOf = params.asOf || today;
    const staleDays = params.staleDays ?? defaultStaleDays ?? 90;
    const latest = (list, key) => list.reduce((m, x) => (!m || x[key] > m ? x[key] : m), null);
    const rows = [];
    for (const p of partners) {
      const newsletter = latest(p.files, "receivedDate");
      const days = newsletter ? daysBetween(asOf, newsletter) : null;
      const contact = contactLogOn ? latest(p.contactLogs || [], "contactDate") : null;
      const contactDays = contact ? daysBetween(asOf, contact) : null;
      const visit = latest(p.churchVisits, "visitDate");
      // A visit in the future isn't something we have "heard"; only visits up to the as-of day.
      const visitDays = visit && visit <= asOf ? daysBetween(asOf, visit) : null;
      // A prayer request received from them is hearing from them too (not one dated after the day).
      const prayerDate = latest(p.prayerRequests, "dateReceived");
      const prayerDays = prayerDate && prayerDate <= asOf ? daysBetween(asOf, prayerDate) : null;
      // Days since the most recent of these; null when none exists.
      const quietDays = [days, contactDays, visitDays, prayerDays]
        .filter((d) => d !== null)
        .reduce((m, d) => Math.min(m, d), Infinity);
      const quiet = quietDays === Infinity ? null : quietDays;
      const stale = quiet === null || quiet >= staleDays;
      if (params.onlyStale && !stale) continue;
      rows.push({
        partnerName: p.displayName,
        newsletter: ymd(newsletter),
        newsletterDays: days,
        contact: ymd(contact),
        contactDays,
        _quietDays: quiet,
        photo: ymd(latest(p.photos, "receivedDate")),
        prayer: ymd(latest(p.prayerRequests, "dateReceived")),
        visit: ymd(latest(p.churchVisits, "visitDate")),
        lastPrayedWithCongregation: ymd(p.lastPrayedWithCongregationAt),
        _restricted: p.isRestricted,
      });
    }
    rows.sort(
      (a, b) =>
        (b._quietDays ?? 99999) - (a._quietDays ?? 99999) || a.partnerName.localeCompare(b.partnerName)
    );
    return {
      rows,
      summary: [
        {
          label: "Quiet partners",
          value: rows.filter((r) => r._quietDays === null || r._quietDays >= staleDays).length,
        },
        { label: "Never sent a newsletter", value: rows.filter((r) => r.newsletterDays === null).length },
      ],
      notes: [
        contactLogOn
          ? "'Quiet' is measured from the most recent of a newsletter file, a prayer request, a logged contact or a church visit."
          : "'Quiet' is measured from the most recent of a newsletter file, a prayer request or a church visit.",
      ],
    };
  },
};

// Which partners have no one assigned to keep in touch. Part of the reporting hub
// (AGENTS.md); only exists while the careTeam feature is on.
const careTeamCoverage = {
  id: "care-team-coverage",
  group: "people",
  label: "Care team coverage",
  question: "Which partners have nobody assigned to keep in touch?",
  requiresFeature: "careTeam",
  params: z.object({
    onlyGaps: flag(true),
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [
    { name: "onlyGaps", label: "Only partners needing attention", type: "checkbox" },
    kindField,
    archivedField,
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "status", label: "Status" },
    { key: "lead", label: "Lead" },
    { key: "members", label: "Members", type: "number" },
  ],
  fetch: (params, { prisma }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        displayName: true,
        isRestricted: true,
        careTeam: {
          select: { isLead: true, user: { select: { email: true, firstName: true, lastName: true } } },
        },
      },
    }),
  compute(partners, params) {
    const name = (u) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
    const rows = [];
    for (const p of partners) {
      const lead = p.careTeam.find((m) => m.isLead);
      const members = p.careTeam.filter((m) => !m.isLead);
      const status = p.careTeam.length === 0 ? "No care team" : lead ? "Covered" : "No lead";
      if (params.onlyGaps && status === "Covered") continue;
      rows.push({
        partnerName: p.displayName,
        status,
        lead: lead ? name(lead.user) : "",
        members: members.length,
        _restricted: p.isRestricted,
      });
    }
    rows.sort((a, b) => a.status.localeCompare(b.status) || a.partnerName.localeCompare(b.partnerName));
    return {
      rows,
      summary: [
        { label: "No care team", value: rows.filter((r) => r.status === "No care team").length },
        { label: "No lead", value: rows.filter((r) => r.status === "No lead").length },
      ],
      notes: ["Counts members as the people on the team other than the lead."],
    };
  },
};

// What partners have asked the church and their care team for: one row per partner
// and chosen option (so filtering by an option answers "which partners want X"), or
// partners with nothing recorded. A partner's answers can be sensitive, so a
// restricted partner's are masked like its other sensitive fields.
const supportPreferences = {
  id: "support-preferences",
  group: "people",
  label: "Support preferences",
  question: "What has each partner asked us for, and who has no preferences recorded yet?",
  requiresFeature: "supportPreferences",
  params: z.object({
    show: oneOf(["recorded", "none"], "recorded"),
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [
    {
      name: "show",
      label: "Show",
      type: "select",
      options: [
        { value: "recorded", label: "What partners have chosen" },
        { value: "none", label: "Partners with nothing recorded" },
      ],
    },
    kindField,
    archivedField,
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "group", label: "Group" },
    { key: "option", label: "Option", sensitive: true },
    { key: "answer", label: "Answer", sensitive: true },
    { key: "note", label: "Note", sensitive: true },
  ],
  fetch: (params, { prisma }) =>
    prisma.partner.findMany({
      where: baseWhere(params),
      select: {
        displayName: true,
        isRestricted: true,
        supportPreferences: {
          select: {
            selected: true,
            choice: true,
            choices: true,
            other: true,
            text: true,
            note: true,
            option: { select: { group: true, label: true, kind: true, sortOrder: true } },
          },
        },
      },
    }),
  compute(partners, params) {
    const rows = [];
    for (const p of partners) {
      const chosen = p.supportPreferences.filter((r) => r.selected || r.note);
      if (params.show === "none") {
        if (chosen.length === 0)
          rows.push({
            partnerName: p.displayName,
            group: "",
            option: "",
            answer: "",
            note: "",
            _restricted: p.isRestricted,
          });
        continue;
      }
      for (const r of chosen) {
        rows.push({
          partnerName: p.displayName,
          group: r.option.group,
          option: r.option.label,
          answer: describeAnswer(r.option, r),
          note: r.note || "",
          _restricted: p.isRestricted,
          _order: r.option.sortOrder,
        });
      }
    }
    rows.sort(
      (a, b) =>
        a.partnerName.localeCompare(b.partnerName) ||
        a.group.localeCompare(b.group) ||
        (a._order ?? 0) - (b._order ?? 0)
    );
    return {
      rows: rows.map(({ _order, ...row }) => row),
      summary:
        params.show === "none"
          ? [{ label: "Partners with nothing recorded", value: rows.length }]
          : [
              { label: "Partners with preferences", value: new Set(rows.map((r) => r.partnerName)).size },
              { label: "Choices recorded", value: rows.length },
            ],
      notes: ["Retired options keep their answers and are still listed."],
    };
  },
};

// Who has been sent each open or closed survey and who has answered (#419). One row per partner
// and survey: "waiting" is invited but not answered, the follow-up list for a reminder.
const surveyProgress = {
  id: "survey-progress",
  group: "people",
  label: "Survey responses",
  question: "Who has answered each survey, and who is still waiting?",
  requiresFeature: "surveys",
  params: z.object({
    show: oneOf(["waiting", "answered", "not-sent"], "waiting"),
    kind: oneOf(KIND_VALUES, "all"),
    sendingChurch: sendingChurchParam,
    includeArchived: flag(false),
  }),
  fields: [
    {
      name: "show",
      label: "Show",
      type: "select",
      options: [
        { value: "waiting", label: "Sent, not answered yet" },
        { value: "answered", label: "Answered" },
        { value: "not-sent", label: "Not sent yet" },
      ],
    },
    kindField,
    archivedField,
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "survey", label: "Survey" },
    { key: "status", label: "Status" },
    { key: "sentOn", label: "Link sent", type: "date" },
    { key: "answeredOn", label: "Answered", type: "date" },
  ],
  fetch: async (params, { prisma }) => {
    const [partners, surveys] = await Promise.all([
      prisma.partner.findMany({
        where: baseWhere(params),
        select: {
          id: true,
          displayName: true,
          surveyInvites: { select: { surveyId: true, sentAt: true } },
          surveyResponses: { select: { surveyId: true, submittedAt: true } },
        },
      }),
      prisma.survey.findMany({
        where: { status: { in: ["open", "closed"] } },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { partners, surveys };
  },
  compute({ partners, surveys }, params) {
    const rows = [];
    for (const survey of surveys) {
      for (const p of partners) {
        const invite = p.surveyInvites.find((i) => i.surveyId === survey.id);
        const response = p.surveyResponses.find((r) => r.surveyId === survey.id);
        const answered = Boolean(response?.submittedAt);
        const state = answered ? "answered" : invite?.sentAt ? "waiting" : "not-sent";
        if (state !== params.show) continue;
        if (state === "not-sent" && survey.status !== "open") continue;
        rows.push({
          partnerName: p.displayName,
          survey: survey.title,
          status: { answered: "Answered", waiting: "Sent, waiting", "not-sent": "Not sent" }[state],
          sentOn: invite?.sentAt || null,
          answeredOn: response?.submittedAt || null,
        });
      }
    }
    rows.sort((a, b) => a.survey.localeCompare(b.survey) || a.partnerName.localeCompare(b.partnerName));
    return {
      rows,
      summary: [{ label: "Partners listed", value: new Set(rows.map((r) => r.partnerName)).size }],
      notes: ["Draft surveys are not listed. Not-sent counts only open surveys."],
    };
  },
};

module.exports = {
  reports: [
    keyDates,
    languageCoverage,
    whereWeServe,
    partnerRoster,
    lastHeardFrom,
    careTeamCoverage,
    supportPreferences,
    surveyProgress,
  ],
};
