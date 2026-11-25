// #291: the database half of key-date reminders -- who a coming birthday /
// anniversary / milestone is for, and which are still open. Shared by the bell
// category and the daily email so the two can never disagree.
//
// Recipients: a partner's whole care team (lead + members), else the church's
// default lead, else nobody. Everything here counts nothing while either the
// keyDates or the careTeam feature is off.

const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { toUtcDay, DAY_MS } = require("../reporting/definitions");
const { upcomingKeyDates, isHandled } = require("./keyDates");
const { careTimings } = require("./careSettings");

async function keyDatesSettings() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true, defaultCareLeadUserId: true },
  });
  const enabled =
    isFeatureEnabled(settings?.enabledFeatures, "keyDates") &&
    isFeatureEnabled(settings?.enabledFeatures, "careTeam");
  const { keyDateLeadDays } = await careTimings();
  return { enabled, defaultLeadId: settings?.defaultCareLeadUserId || null, keyDateLeadDays };
}

// Every open key date in the window, each with the people it goes to.
// `today` is a Date (UTC day). Returns [] while the features are off.
//   item: { partnerId, partner:{...}, kind, subjectId, who, occasion, date,
//           daysUntil, turning, recipientIds:[userId] }
async function loadOpenKeyDates(today = new Date()) {
  const { enabled, defaultLeadId, keyDateLeadDays } = await keyDatesSettings();
  if (!enabled) return [];
  const day = toUtcDay(today);

  const partners = await prisma.partner.findMany({
    where: { archived: false },
    select: {
      id: true,
      kind: true,
      displayName: true,
      fieldDisplayName: true,
      isRestricted: true,
      contactLevel: true,
      anniversary: true,
      supportingSince: true,
      adults: { select: { id: true, firstName: true, lastName: true, birthday: true } },
      children: { select: { id: true, firstName: true, lastName: true, birthday: true } },
    },
  });
  const items = upcomingKeyDates(partners, day, keyDateLeadDays);
  if (items.length === 0) return [];

  const partnerIds = [...new Set(items.map((i) => i.partnerId))];
  const byId = new Map(partners.map((p) => [p.id, p]));

  // Handled by a "key date" contact log entry within the window of the date.
  const from = new Date(day.getTime() - keyDateLeadDays * DAY_MS);
  const to = new Date(day.getTime() + (2 * keyDateLeadDays + 1) * DAY_MS);
  const logs = await prisma.contactLog.findMany({
    where: { partnerId: { in: partnerIds }, topics: { has: "keydate" }, contactDate: { gte: from, lte: to } },
    select: { partnerId: true, topics: true, contactDate: true },
  });
  const logsByPartner = new Map();
  logs.forEach((l) => logsByPartner.set(l.partnerId, [...(logsByPartner.get(l.partnerId) || []), l]));
  const open = items.filter((i) => !isHandled(i, logsByPartner.get(i.partnerId) || []));
  if (open.length === 0) return [];

  // Recipients: active logins on the team, else the default lead.
  const seats = await prisma.careTeamMember.findMany({
    where: { partnerId: { in: [...new Set(open.map((i) => i.partnerId))] }, user: { active: true } },
    select: { partnerId: true, userId: true },
  });
  const teamByPartner = new Map();
  seats.forEach((s) => teamByPartner.set(s.partnerId, [...(teamByPartner.get(s.partnerId) || []), s.userId]));
  let defaultLeadActive = null;
  if (defaultLeadId) {
    const u = await prisma.user.findFirst({
      where: { id: defaultLeadId, active: true },
      select: { id: true },
    });
    defaultLeadActive = u?.id || null;
  }

  return open
    .map((i) => ({
      ...i,
      partner: byId.get(i.partnerId),
      recipientIds: teamByPartner.get(i.partnerId) || (defaultLeadActive ? [defaultLeadActive] : []),
    }))
    .filter((i) => i.recipientIds.length > 0);
}

// The open key dates that go to one login.
async function loadOpenKeyDatesFor(userId, today = new Date()) {
  const all = await loadOpenKeyDates(today);
  return all.filter((i) => i.recipientIds.includes(userId));
}

module.exports = { loadOpenKeyDates, loadOpenKeyDatesFor, keyDatesSettings };
