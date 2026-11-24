// #288: the "partners I look after" read model, shared by the Assigned to me
// tab (GET /api/contact-log/assigned) and the partnersNeedingContact
// notification so the two can never disagree about who is overdue.

const prisma = require("../prismaClient");
const { nextAnnual, daysBetween, toUtcDay, DAY_MS } = require("../reporting/definitions");
const { isFeatureEnabled } = require("./features");
const { CONTACT_STALE_DAYS, autoLogForPrayerRequest } = require("./contactLog");

// Latest contact date per partner, from the log alone. Any entry counts,
// whichever direction and whoever made it -- "has anyone been in touch".
async function lastContactByPartner(partnerIds) {
  if (partnerIds.length === 0) return new Map();
  const rows = await prisma.contactLog.groupBy({
    by: ["partnerId"],
    where: { partnerId: { in: partnerIds } },
    _max: { contactDate: true },
  });
  return new Map(rows.map((r) => [r.partnerId, r._max.contactDate]));
}

// The earliest follow-up date still waiting on a later contact: a follow-up
// is answered the moment anything is logged on or after the day it was set.
function openFollowUp(logs) {
  const open = logs.filter(
    (l) =>
      l.followUpDate &&
      !logs.some((o) => o.id !== l.id && o.contactDate >= l.contactDate && o.createdAt > l.createdAt)
  );
  return open.reduce((min, l) => (!min || l.followUpDate < min ? l.followUpDate : min), null);
}

// Every partner this login holds a care team seat on (not archived), with the
// columns the tab shows. `today` is a Date (UTC day) so tests can pin it.
async function loadAssignedPartners(userId, today = new Date()) {
  const seats = await prisma.careTeamMember.findMany({
    where: { userId, partner: { archived: false } },
    select: {
      isLead: true,
      createdAt: true,
      partner: {
        select: {
          id: true,
          kind: true,
          displayName: true,
          isRestricted: true,
          anniversary: true,
          adults: { select: { firstName: true, birthday: true } },
          children: { select: { firstName: true, birthday: true } },
          contactLogs: { select: { id: true, contactDate: true, followUpDate: true, createdAt: true } },
          prayerRequests: { where: { status: "ongoing" }, select: { id: true } },
          needRequests: { where: { approvedAmount: null }, select: { id: true } },
        },
      },
    },
  });

  const rows = seats.map(({ isLead, createdAt: seatSince, partner: p }) => {
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

    // When this partner became overdue: the day the quiet clock ran out (from
    // the last contact, or from joining the team if never contacted), or the
    // follow-up date, whichever came first. The notification uses the latest
    // of these to know when something NEW needs attention.
    const quietSince = new Date(toUtcDay(last || seatSince).getTime() + CONTACT_STALE_DAYS * DAY_MS);
    const dueDates = [];
    if (daysSinceContact === null || daysSinceContact >= CONTACT_STALE_DAYS) dueDates.push(quietSince);
    if (followUpDue) dueDates.push(toUtcDay(followUp));
    const overdueSince = dueDates.length ? new Date(Math.min(...dueDates)) : null;

    return {
      partnerId: p.id,
      kind: p.kind,
      displayName: p.displayName,
      isRestricted: p.isRestricted,
      isLead,
      lastContact: last ? toUtcDay(last).toISOString().slice(0, 10) : null,
      daysSinceContact,
      quiet: daysSinceContact === null || daysSinceContact >= CONTACT_STALE_DAYS,
      followUpDate: followUp ? toUtcDay(followUp).toISOString().slice(0, 10) : null,
      followUpDue,
      overdueSince: overdueSince ? overdueSince.toISOString().slice(0, 10) : null,
      nextKeyDate,
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

async function isContactLogEnabled() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return isFeatureEnabled(settings?.enabledFeatures, "contactLog");
}

// A care team member's new prayer request is also the contact they just had.
// Best-effort, like the notifications: a failure here must never block saving
// the request itself. Returns the entry, or null when off / not applicable.
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
  openFollowUp,
  isContactLogEnabled,
  logContactForPrayerRequest,
};
