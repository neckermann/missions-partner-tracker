// Communication and intake: dispatch health and the trip application funnel.
const { z } = require("zod");
const { optionalDay, oneOf, sendingChurchParam, sendingChurchField } = require("../params");
const { withSendingChurch } = require("../../utils/sendingChurch");
const { hoursBetween, average, daysBetween } = require("../definitions");

const dispatchHealth = {
  id: "dispatch-health",
  group: "communication",
  label: "Update sending health",
  question: "Are our GroupMe, WhatsApp and email sends going out, and how fast are they reviewed?",
  params: z.object({ from: optionalDay, to: optionalDay }),
  fields: [
    { name: "from", label: "From", type: "date" },
    { name: "to", label: "To", type: "date" },
  ],
  chart: { kind: "bar", label: "type", value: "total", title: "Updates by type", limit: 10 },
  columns: [
    { key: "type", label: "Update type" },
    { key: "total", label: "Created", type: "number" },
    { key: "reviewed", label: "Reviewed", type: "number" },
    { key: "avgReviewHours", label: "Avg hours to review", type: "number" },
    { key: "groupmeErrors", label: "GroupMe errors", type: "number" },
    { key: "whatsappErrors", label: "WhatsApp errors", type: "number" },
    { key: "emailErrors", label: "Email errors", type: "number" },
  ],
  fetch: (params, { prisma }) =>
    prisma.dispatchRecord.findMany({
      where:
        params.from || params.to
          ? {
              createdAt: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lt: new Date(params.to.getTime() + 86400000) } : {}),
              },
            }
          : {},
      select: {
        type: true,
        createdAt: true,
        dispatchReviewedAt: true,
        groupmeError: true,
        whatsappError: true,
        emailError: true,
      },
    }),
  compute(records) {
    const byType = new Map();
    for (const r of records) {
      const row = byType.get(r.type) || {
        type: r.type,
        total: 0,
        reviewed: 0,
        hours: [],
        groupmeErrors: 0,
        whatsappErrors: 0,
        emailErrors: 0,
      };
      row.total += 1;
      if (r.dispatchReviewedAt) {
        row.reviewed += 1;
        row.hours.push(hoursBetween(r.dispatchReviewedAt, r.createdAt));
      }
      if (r.groupmeError) row.groupmeErrors += 1;
      if (r.whatsappError) row.whatsappErrors += 1;
      if (r.emailError) row.emailErrors += 1;
      byType.set(r.type, row);
    }
    const rows = [...byType.values()]
      .map(({ hours, ...r }) => ({ ...r, avgReviewHours: average(hours) }))
      .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
    const errors = rows.reduce((s, r) => s + r.groupmeErrors + r.whatsappErrors + r.emailErrors, 0);
    return {
      rows,
      summary: [
        { label: "Updates", value: records.length },
        { label: "Awaiting review", value: records.filter((r) => !r.dispatchReviewedAt).length },
        { label: "Send errors", value: errors },
      ],
      notes: ["Counts every update recorded, including ones that never needed review."],
    };
  },
};

const applicationFunnel = {
  id: "application-funnel",
  group: "trips",
  label: "Application funnel",
  question: "How many people applied, and how many were approved?",
  requiresFeature: "trips",
  params: z.object({
    status: oneOf(["active", "all", "planning", "accepting_applications", "closed", "completed"], "all"),
    sendingChurch: sendingChurchParam,
  }),
  fields: [
    {
      name: "status",
      label: "Trip status",
      type: "select",
      options: [
        { value: "all", label: "All" },
        { value: "active", label: "Planning / applying" },
        { value: "planning", label: "Planning" },
        { value: "accepting_applications", label: "Accepting applications" },
        { value: "closed", label: "Closed" },
        { value: "completed", label: "Completed" },
      ],
    },
    sendingChurchField,
  ],
  columns: [
    { key: "trip", label: "Trip" },
    { key: "submitted", label: "Applications", type: "number" },
    { key: "pending", label: "Pending", type: "number" },
    { key: "approved", label: "Approved", type: "number" },
    { key: "declined", label: "Declined", type: "number" },
    { key: "withdrawn", label: "Withdrawn", type: "number" },
    { key: "approvalRate", label: "Approval rate (%)", type: "number" },
    { key: "avgDaysToReview", label: "Avg days to review", type: "number" },
  ],
  fetch: (params, { prisma }) =>
    prisma.trip.findMany({
      where: withSendingChurch(
        params.status === "all"
          ? {}
          : params.status === "active"
            ? { status: { in: ["planning", "accepting_applications", "closed"] } }
            : { status: params.status },
        params.sendingChurch
      ),
      select: {
        name: true,
        startDate: true,
        applications: { select: { status: true, createdAt: true, reviewedAt: true } },
      },
    }),
  compute(trips) {
    const rows = trips
      .filter((t) => t.applications.length > 0)
      .map((t) => {
        const count = (s) => t.applications.filter((a) => a.status === s).length;
        const approved = count("approved");
        const declined = count("declined");
        const days = t.applications
          .filter((a) => a.reviewedAt)
          .map((a) => daysBetween(a.reviewedAt, a.createdAt));
        return {
          trip: t.name || "Untitled trip",
          submitted: t.applications.length,
          pending: count("pending"),
          approved,
          declined,
          withdrawn: count("withdrawn"),
          approvalRate: approved + declined ? Math.round((approved / (approved + declined)) * 100) : null,
          avgDaysToReview: average(days),
        };
      });
    const total = rows.reduce((s, r) => s + r.submitted, 0);
    return {
      rows,
      summary: [
        { label: "Applications", value: total },
        { label: "Pending review", value: rows.reduce((s, r) => s + r.pending, 0) },
        { label: "Approved", value: rows.reduce((s, r) => s + r.approved, 0) },
      ],
      notes: ["Approval rate is approved out of decided (approved + declined)."],
    };
  },
};

module.exports = { reports: [dispatchHealth, applicationFunnel] };
