// The "partners I look after" read model, shared by the My partners tab (GET
// /api/contact-log/assigned) and the partnersNeedingContact notification so they agree on who is overdue.

const prisma = require("../prismaClient");
const { nextAnnual, daysBetween, toUtcDay, DAY_MS } = require("../reporting/definitions");
const { isFeatureEnabled } = require("./features");
const { autoLogForPrayerRequest } = require("./contactLog");
const { emailBlockReason, surveyEmailFor } = require("./contactReach");
const { careTimings } = require("./careSettings");

// Latest contact date per partner, from the log alone. Any entry counts: "has anyone been in touch".
async function lastContactByPartner(partnerIds) {
  if (partnerIds.length === 0) return new Map();
  const rows = await prisma.contactLog.groupBy({
    by: ["partnerId"],
    where: { partnerId: { in: partnerIds } },
    _max: { contactDate: true },
  });
  return new Map(rows.map((r) => [r.partnerId, r._max.contactDate]));
}

// The earliest follow-up date still waiting on a later contact (answered once anything is logged on or after it).
function openFollowUp(logs) {
  const open = logs.filter(
    (l) =>
      l.followUpDate &&
      !logs.some((o) => o.id !== l.id && o.contactDate >= l.contactDate && o.createdAt > l.createdAt)
  );
  return open.reduce((min, l) => (!min || l.followUpDate < min ? l.followUpDate : min), null);
}

// Every partner this login holds a care team seat on (not archived), with the tab's columns. `today` is a UTC-day Date so tests can pin it.
async function loadAssignedPartners(userId, today = new Date()) {
  const { contactStaleDays } = await careTimings();
  const partnerSelect = {
    id: true,
    kind: true,
    displayName: true,
    isRestricted: true,
    createdAt: true,
    anniversary: true,
    adoptedAt: true,
    commissionedAt: true,
    contactLevel: true,
    contactChannels: true,
    contactEmail: true,
    adults: { select: { firstName: true, birthday: true, email: true, isPrimaryContact: true } },
    children: { select: { firstName: true, birthday: true } },
    contactLogs: { select: { id: true, contactDate: true, followUpDate: true, createdAt: true } },
    prayerRequests: { where: { status: "ongoing" }, select: { id: true } },
    needRequests: { where: { approvedAmount: null }, select: { id: true } },
  };
  const seats = await prisma.careTeamMember.findMany({
    where: { userId, partner: { archived: false } },
    select: { isLead: true, createdAt: true, partner: { select: partnerSelect } },
  });

  // The church's default lead is the fallback for a partner with no care team,
  // as key-date reminders use. Staff only: a guest's reach is exactly their
  // grants and a fallback must not widen it.
  let fallback = [];
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { defaultCareLeadUserId: true },
  });
  if (settings?.defaultCareLeadUserId && settings.defaultCareLeadUserId === userId) {
    const lead = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, active: true },
    });
    if (lead?.active && lead.role !== "guest") {
      const partners = await prisma.partner.findMany({
        where: { archived: false, careTeam: { none: {} } },
        select: partnerSelect,
      });
      fallback = partners.map((partner) => ({
        isLead: false,
        createdAt: partner.createdAt,
        partner,
        viaDefaultLead: true,
      }));
    }
  }

  const rows = [...seats, ...fallback].map(({ isLead, createdAt: seatSince, partner: p, viaDefaultLead }) => {
    const last = p.contactLogs.reduce((m, l) => (!m || l.contactDate > m ? l.contactDate : m), null);
    const daysSinceContact = last ? daysBetween(today, last) : null;
    const followUp = openFollowUp(p.contactLogs);
    const followUpDue = !!followUp && daysBetween(today, followUp) >= 0;

    // The soonest birthday or anniversary on the family record.
    let nextKeyDate = null;
    const consider = (date, occasion, who) => {
      if (!date) return;
      const n = nextAnnual(date, today);
      if (!nextKeyDate || n.daysUntil < nextKeyDate.daysUntil) {
        nextKeyDate = { date: n.next.toISOString().slice(0, 10), daysUntil: n.daysUntil, occasion, who };
      }
    };
    p.adults.forEach((a) => consider(a.birthday, "Birthday", a.firstName || ""));
    p.children.forEach((c) => consider(c.birthday, "Birthday", c.firstName || ""));
    consider(p.anniversary, "Anniversary", "");
    consider(p.adoptedAt, "Adopted by our church", "");
    consider(p.commissionedAt, "Commissioned", "");

    // When this partner became overdue: when the quiet clock ran out (from the last
    // contact, or joining the team if never contacted) or the follow-up date,
    // whichever came first. The notification uses the latest to detect NEW items.
    const quietSince = new Date(toUtcDay(last || seatSince).getTime() + contactStaleDays * DAY_MS);
    const dueDates = [];
    if (daysSinceContact === null || daysSinceContact >= contactStaleDays) dueDates.push(quietSince);
    if (followUpDue) dueDates.push(toUtcDay(followUp));
    const overdueSince = dueDates.length ? new Date(Math.min(...dueDates)) : null;

    return {
      partnerId: p.id,
      kind: p.kind,
      displayName: p.displayName,
      isRestricted: p.isRestricted,
      isLead,
      viaDefaultLead: viaDefaultLead === true,
      lastContact: last ? toUtcDay(last).toISOString().slice(0, 10) : null,
      daysSinceContact,
      quiet: daysSinceContact === null || daysSinceContact >= contactStaleDays,
      followUpDate: followUp ? toUtcDay(followUp).toISOString().slice(0, 10) : null,
      followUpDue,
      overdueSince: overdueSince ? overdueSince.toISOString().slice(0, 10) : null,
      nextKeyDate,
      // Where a greeting for that date could be emailed: null when we must not (restricted, don't
      // contact directly, ways exclude email) or have no address.
      greetingEmail: emailBlockReason(p) ? null : surveyEmailFor(p, p.adults),
      openPrayers: p.prayerRequests.length,
      openNeeds: p.needRequests.length,
    };
  });

  // Longest quiet first; never-contacted partners lead the list.
  rows.sort(
    (a, b) =>
      (b.daysSinceContact ?? 99999) - (a.daysSinceContact ?? 99999) ||
      a.displayName.localeCompare(b.displayName)
  );
  return rows;
}

// An answered prayer or decided need nobody has passed on yet (bell and per-partner
// contact log): done once someone logs an OUTBOUND contact for the partner on or
// after it (topic "need" for a decision, "encouragement" or "prayer" for an answer).
// Items are [{ partnerId, kind: "need" | "prayer", id, date, label, topic }], `topic`
// being what a thank-you would be logged under.
const UPDATE_WINDOW_DAYS = 30;

async function loadUpdatesToPassOn(partnerIds, now = new Date()) {
  if (partnerIds.length === 0) return [];
  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - UPDATE_WINDOW_DAYS * 86400000
  );
  const [needs, prayers, logs] = await Promise.all([
    prisma.supportNeed.findMany({
      where: { partnerId: { in: partnerIds }, approvedDate: { gte: since } },
      select: { id: true, partnerId: true, approvedDate: true, description: true },
    }),
    prisma.prayerRequest.findMany({
      where: { partnerId: { in: partnerIds }, status: "answered", dateAnswered: { gte: since } },
      select: { id: true, partnerId: true, dateAnswered: true, requestText: true },
    }),
    prisma.contactLog.findMany({
      where: { partnerId: { in: partnerIds }, direction: "outbound", contactDate: { gte: since } },
      select: { partnerId: true, contactDate: true, topics: true },
    }),
  ]);
  const relayed = (partnerId, date, topics) =>
    logs.some(
      (l) => l.partnerId === partnerId && l.contactDate >= date && l.topics.some((t) => topics.includes(t))
    );
  const short = (text) => {
    const t = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    return t.length > 90 ? `${t.slice(0, 87)}...` : t;
  };
  return [
    ...needs
      .filter((n) => !relayed(n.partnerId, n.approvedDate, ["need"]))
      .map((n) => ({
        partnerId: n.partnerId,
        kind: "need",
        id: n.id,
        date: n.approvedDate,
        label: short(n.description),
        topic: "need",
      })),
    ...prayers
      .filter((p) => !relayed(p.partnerId, p.dateAnswered, ["encouragement", "prayer"]))
      .map((p) => ({
        partnerId: p.partnerId,
        kind: "prayer",
        id: p.id,
        date: p.dateAnswered,
        label: short(p.requestText),
        topic: "encouragement",
      })),
  ];
}

async function isContactLogEnabled() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return isFeatureEnabled(settings?.enabledFeatures, "contactLog");
}

// A care team member's new prayer request is also a contact they just had.
// Best-effort: a failure must never block saving the request. Returns the entry, or null.
async function logContactForPrayerRequest(request, user, options) {
  try {
    if (!(await isContactLogEnabled())) return null;
    return await prisma.contactLog.create({ data: autoLogForPrayerRequest(request, user.id, options) });
  } catch (err) {
    console.error("Couldn't log the contact for a new prayer request:", err.message);
    return null;
  }
}

module.exports = {
  lastContactByPartner,
  loadAssignedPartners,
  loadUpdatesToPassOn,
  openFollowUp,
  isContactLogEnabled,
  logContactForPrayerRequest,
};
