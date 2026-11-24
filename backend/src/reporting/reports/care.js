// Partner care: prayer requests, one-time needs, data completeness.
const { z } = require("zod");
const { latestOf, partnerLastUpdated } = require("../../utils/lastUpdated");
const { optionalDay, flag, oneOf, ymd, KIND_VALUES } = require("../params");
const {
  prayerState,
  PRAYER_AGE_BUCKETS,
  needDecision,
  needTurnaroundDays,
  sumAmounts,
  completeness,
  COMPLETENESS_CHECKS,
} = require("../definitions");

const prayerRequests = {
  id: "prayer-requests",
  group: "care",
  label: "Prayer requests",
  question: "What are we praying for, and how long has it been open?",
  requiresFeature: "prayerRequests",
  params: z.object({
    asOf: optionalDay,
    status: oneOf(["all", "open", "answered", "untracked"], "open"),
    category: oneOf(["all", "strategic", "situational"], "all"),
    bucket: oneOf(["all", ...PRAYER_AGE_BUCKETS], "all"),
    urgentOnly: flag(false),
    includeArchived: flag(false),
  }),
  fields: [
    { name: "asOf", label: "As of", type: "date" },
    {
      name: "bucket",
      label: "Time open",
      type: "select",
      options: [{ value: "all", label: "Any" }, ...PRAYER_AGE_BUCKETS.map((b) => ({ value: b, label: b }))],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "open", label: "Open (ongoing)" },
        { value: "answered", label: "Answered" },
        { value: "untracked", label: "Untracked" },
        { value: "all", label: "All" },
      ],
    },
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
    { name: "urgentOnly", label: "Urgent only", type: "checkbox" },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "category", label: "Category" },
    { key: "state", label: "Status" },
    { key: "received", label: "Received", type: "date" },
    { key: "ageDays", label: "Days open", type: "number" },
    { key: "daysToAnswer", label: "Days to answer", type: "number" },
    { key: "urgent", label: "Urgent" },
    { key: "request", label: "Request", sensitive: true },
  ],
  fetch: (params, { prisma }) =>
    prisma.prayerRequest.findMany({
      where: {
        ...(params.category !== "all" ? { category: params.category } : {}),
        ...(params.urgentOnly ? { isUrgent: true } : {}),
        partner: params.includeArchived ? {} : { archived: false },
      },
      select: {
        category: true,
        status: true,
        dateReceived: true,
        dateAnswered: true,
        isUrgent: true,
        requestText: true,
        partner: { select: { displayName: true, isRestricted: true } },
      },
    }),
  compute(requests, params, { today }) {
    const asOf = params.asOf || today;
    const rows = [];
    const buckets = Object.fromEntries(PRAYER_AGE_BUCKETS.map((b) => [b, 0]));
    const answeredDays = [];
    for (const r of requests) {
      const s = prayerState(r, asOf);
      if (params.status !== "all" && s.state !== params.status) continue;
      if (s.bucket) buckets[s.bucket] += 1;
      if (params.bucket !== "all" && s.bucket !== params.bucket) continue;
      if (s.daysToAnswer != null) answeredDays.push(s.daysToAnswer);
      rows.push({
        partnerName: r.partner.displayName,
        category: r.category,
        state: s.state,
        received: ymd(r.dateReceived),
        ageDays: s.ageDays,
        daysToAnswer: s.daysToAnswer,
        urgent: r.isUrgent ? "Yes" : "",
        request: r.requestText,
        _restricted: r.partner.isRestricted,
      });
    }
    rows.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
    const avg = answeredDays.length
      ? Math.round(answeredDays.reduce((s, d) => s + d, 0) / answeredDays.length)
      : null;
    return {
      rows,
      summary: [
        { label: "Shown", value: rows.length },
        ...PRAYER_AGE_BUCKETS.map((b) => ({
          label: `Open ${b}`,
          value: buckets[b],
          filter: { status: "open", bucket: b },
        })),
        { label: "Avg days to answer", value: avg ?? "—" },
      ],
      notes: ["Open means status ongoing. Untracked requests are neither open nor answered."],
    };
  },
};

const needsPipeline = {
  id: "needs-pipeline",
  group: "care",
  label: "One-time needs",
  question: "What has been asked for, what was decided, and how fast?",
  requiresFeature: "oneTimeNeeds",
  params: z.object({
    from: optionalDay,
    to: optionalDay,
    decision: oneOf(["all", "pending", "approved", "partial", "declined"], "all"),
    includeArchived: flag(false),
  }),
  fields: [
    { name: "from", label: "Requested from", type: "date" },
    { name: "to", label: "Requested to", type: "date" },
    {
      name: "decision",
      label: "Decision",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "pending", label: "Pending" },
        { value: "approved", label: "Approved" },
        { value: "partial", label: "Partially funded" },
        { value: "declined", label: "Declined" },
      ],
    },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "description", label: "Need", sensitive: true },
    { key: "decision", label: "Decision" },
    { key: "requested", label: "Requested ($)", type: "currency" },
    { key: "approved", label: "Approved ($)", type: "currency" },
    { key: "requestDate", label: "Requested", type: "date" },
    { key: "turnaround", label: "Days to decide", type: "number" },
    { key: "urgent", label: "Urgent" },
  ],
  fetch: (params, { prisma }) =>
    prisma.supportNeed.findMany({
      where: {
        ...(params.from || params.to
          ? {
              requestDate: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
        partner: params.includeArchived ? {} : { archived: false },
      },
      select: {
        description: true,
        requestedAmount: true,
        approvedAmount: true,
        requestDate: true,
        approvedDate: true,
        isUrgent: true,
        partner: { select: { displayName: true, isRestricted: true } },
      },
    }),
  compute(needs, params) {
    const rows = [];
    const days = [];
    for (const n of needs) {
      const decision = needDecision(n);
      if (params.decision !== "all" && decision !== params.decision) continue;
      const turnaround = needTurnaroundDays(n);
      if (turnaround != null) days.push(turnaround);
      rows.push({
        partnerName: n.partner.displayName,
        description: n.description,
        decision,
        requested: n.requestedAmount,
        approved: n.approvedAmount,
        requestDate: ymd(n.requestDate),
        turnaround,
        urgent: n.isUrgent ? "Yes" : "",
        _restricted: n.partner.isRestricted,
      });
    }
    rows.sort((a, b) => String(b.requestDate).localeCompare(String(a.requestDate)));
    const decided = rows.filter((r) => r.decision !== "pending");
    return {
      rows,
      summary: [
        { label: "Requests", value: rows.length },
        {
          label: "Pending",
          value: rows.filter((r) => r.decision === "pending").length,
          filter: { decision: "pending" },
        },
        {
          label: "Requested",
          value: sumAmounts(rows.map((r) => ({ amount: r.requested }))),
          type: "currency",
        },
        {
          label: "Approved",
          value: sumAmounts(decided.map((r) => ({ amount: r.approved }))),
          type: "currency",
        },
        {
          label: "Avg days to decide",
          value: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : "—",
        },
      ],
      notes: [
        "Approved amount blank means undecided; $0 means declined; less than requested means partially funded.",
      ],
    };
  },
};

const dataCompleteness = {
  id: "data-completeness",
  group: "care",
  label: "Data completeness",
  question: "Which partner records are missing basics?",
  params: z.object({
    kind: oneOf(KIND_VALUES, "all"),
    includeArchived: flag(false),
    onlyIncomplete: flag(true),
  }),
  fields: [
    {
      name: "kind",
      label: "Partner type",
      type: "select",
      options: KIND_VALUES.map((v) => ({ value: v, label: v === "all" ? "All" : v })),
    },
    { name: "onlyIncomplete", label: "Only partners with gaps", type: "checkbox" },
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "percent", label: "Complete (%)", type: "number" },
    { key: "missing", label: "Missing" },
    { key: "editedBy", label: "Last edited by" },
    { key: "editedOn", label: "Last edited", type: "date" },
  ],
  fetch: async (params, { prisma }) => {
    const partners = await prisma.partner.findMany({
      where: {
        ...(params.includeArchived ? {} : { archived: false }),
        ...(params.kind !== "all" ? { kind: params.kind } : {}),
      },
      select: {
        displayName: true,
        isRestricted: true,
        overviewShort: true,
        overview: true,
        contactEmail: true,
        contactPhone: true,
        preferredContactMethod: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        emergencyContactEmail: true,
        supportingSince: true,
        lastEditedByName: true,
        lastEditedAt: true,
        addresses: { select: { id: true } },
        languages: { select: { id: true } },
        photos: { select: { id: true } },
      },
    });
    // "Last edited" reads across the partner's sections, like its own page does.
    const updated = await partnerLastUpdated(
      partners.map((p) => p.id),
      prisma
    );
    return partners.map((p) => {
      const shown = latestOf([{ at: p.lastEditedAt, name: p.lastEditedByName }, updated.get(p.id)]);
      return { ...p, lastEditedAt: shown?.at ?? null, lastEditedByName: shown?.name ?? null };
    });
  },
  compute(partners, params) {
    const rows = [];
    const gaps = Object.fromEntries(COMPLETENESS_CHECKS.map((c) => [c.label, 0]));
    for (const p of partners) {
      const c = completeness(p);
      c.missing.forEach((m) => (gaps[m] += 1));
      if (params.onlyIncomplete && c.missing.length === 0) continue;
      rows.push({
        partnerName: p.displayName,
        percent: c.percent,
        missing: c.missing.join(", "),
        editedBy: p.lastEditedByName,
        editedOn: ymd(p.lastEditedAt),
        _restricted: p.isRestricted,
      });
    }
    rows.sort((a, b) => a.percent - b.percent || a.partnerName.localeCompare(b.partnerName));
    const worst = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0];
    return {
      rows,
      summary: [
        { label: "Partners checked", value: partners.length },
        { label: "With gaps", value: partners.filter((p) => completeness(p).missing.length).length },
        { label: "Most common gap", value: worst && worst[1] ? `${worst[0]} (${worst[1]})` : "—" },
      ],
      notes: [
        "Checks overview, contact, preferred contact method, address, emergency contact, language, photo and supporting-since.",
      ],
    };
  },
};

module.exports = { reports: [prayerRequests, needsPipeline, dataCompleteness] };
