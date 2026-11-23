// Trips: fundraising by trip/participant, and requirement readiness.
const { z } = require("zod");
const { flag, oneOf, ymd } = require("../params");
const { fundraising, requirementApplies, requirementDone, sumAmounts } = require("../definitions");

const STATUS_OPTIONS = [
  { value: "active", label: "Planning / applying" },
  { value: "all", label: "All" },
  { value: "planning", label: "Planning" },
  { value: "accepting_applications", label: "Accepting applications" },
  { value: "closed", label: "Closed" },
  { value: "completed", label: "Completed" },
];
const STATUS_VALUES = STATUS_OPTIONS.map((o) => o.value);

function statusWhere(status) {
  if (status === "all") return {};
  if (status === "active") return { status: { in: ["planning", "accepting_applications", "closed"] } };
  return { status };
}

const personName = (p) => [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unnamed";
const tripName = (t) => t.name || "Untitled trip";

const tripFundraising = {
  id: "trip-fundraising",
  group: "trips",
  label: "Trip fundraising",
  question: "How far along is each trip and each participant toward their goal?",
  requiresFeature: "trips",
  params: z.object({ status: oneOf(STATUS_VALUES, "active"), byParticipant: flag(false) }),
  fields: [
    { name: "status", label: "Trip status", type: "select", options: STATUS_OPTIONS },
    { name: "byParticipant", label: "One row per participant", type: "checkbox" },
  ],
  columns: [
    { key: "trip", label: "Trip" },
    { key: "participant", label: "Participant" },
    { key: "start", label: "Departs", type: "date" },
    { key: "goal", label: "Goal ($)", type: "currency" },
    { key: "raised", label: "Raised ($)", type: "currency" },
    { key: "remaining", label: "Remaining ($)", type: "currency" },
    { key: "percent", label: "Of goal (%)", type: "number" },
  ],
  fetch: (params, { prisma }) =>
    prisma.trip.findMany({
      where: statusWhere(params.status),
      select: {
        name: true,
        startDate: true,
        supportRaisingGoal: true,
        contributions: { select: { amount: true, participantId: true } },
        participants: { select: { id: true, firstName: true, lastName: true, supportRaisingGoal: true } },
      },
    }),
  compute(trips, params) {
    const rows = [];
    for (const t of trips) {
      if (!params.byParticipant) {
        const f = fundraising(t.supportRaisingGoal, t.contributions);
        rows.push({
          trip: tripName(t),
          participant: "",
          start: ymd(t.startDate),
          goal: f.goal,
          raised: f.raised,
          remaining: f.remaining,
          percent: f.percent,
        });
        continue;
      }
      for (const p of t.participants) {
        const f = fundraising(
          p.supportRaisingGoal,
          t.contributions.filter((c) => c.participantId === p.id)
        );
        rows.push({
          trip: tripName(t),
          participant: personName(p),
          start: ymd(t.startDate),
          goal: f.goal,
          raised: f.raised,
          remaining: f.remaining,
          percent: f.percent,
        });
      }
    }
    rows.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.trip.localeCompare(b.trip));
    const goal = sumAmounts(rows.map((r) => ({ amount: r.goal })));
    const raised = sumAmounts(rows.map((r) => ({ amount: r.raised })));
    return {
      rows,
      summary: [
        { label: "Rows", value: rows.length },
        { label: "Goal", value: goal, type: "currency" },
        { label: "Raised", value: raised, type: "currency" },
        { label: "Of goal", value: goal ? `${Math.round((raised / goal) * 100)}%` : "—" },
      ],
      notes: ["Per-participant rows count only contributions assigned to that participant."],
    };
  },
};

const tripReadiness = {
  id: "trip-readiness",
  group: "trips",
  label: "Trip readiness",
  question: "Who is still missing a requirement before departure?",
  requiresFeature: "trips",
  params: z.object({ status: oneOf(STATUS_VALUES, "active"), onlyOutstanding: flag(true) }),
  fields: [
    { name: "status", label: "Trip status", type: "select", options: STATUS_OPTIONS },
    { name: "onlyOutstanding", label: "Only participants with open items", type: "checkbox" },
  ],
  columns: [
    { key: "trip", label: "Trip" },
    { key: "participant", label: "Participant" },
    { key: "start", label: "Departs", type: "date" },
    { key: "done", label: "Done", type: "number" },
    { key: "total", label: "Required", type: "number" },
    { key: "outstanding", label: "Outstanding" },
  ],
  fetch: (params, { prisma }) =>
    prisma.trip.findMany({
      where: statusWhere(params.status),
      select: {
        name: true,
        startDate: true,
        requirements: { select: { id: true, label: true, kind: true, minorsOnly: true } },
        documents: { select: { requirementId: true, participantId: true } },
        participants: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            requirementStatuses: { select: { requirementId: true, participantId: true, completedAt: true } },
          },
        },
      },
    }),
  compute(trips, params) {
    const rows = [];
    let complete = 0;
    let people = 0;
    for (const t of trips) {
      for (const p of t.participants) {
        const applicable = t.requirements.filter((r) => requirementApplies(r, p, t.startDate));
        const open = applicable.filter((r) => !requirementDone(r, p.id, p.requirementStatuses, t.documents));
        people += 1;
        if (open.length === 0) complete += 1;
        if (params.onlyOutstanding && open.length === 0) continue;
        rows.push({
          trip: tripName(t),
          participant: personName(p),
          start: ymd(t.startDate),
          done: applicable.length - open.length,
          total: applicable.length,
          outstanding: open.map((r) => r.label).join(", "),
        });
      }
    }
    rows.sort(
      (a, b) => String(a.start).localeCompare(String(b.start)) || b.total - b.done - (a.total - a.done)
    );
    return {
      rows,
      summary: [
        { label: "Participants", value: people },
        { label: "Fully ready", value: complete },
        { label: "With open items", value: people - complete },
      ],
      notes: ["Minors-only requirements apply only to participants under 18 on the trip's start date."],
    };
  },
};

module.exports = { reports: [tripFundraising, tripReadiness] };
