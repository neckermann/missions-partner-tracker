// The database half of key-date reminders: who a coming birthday/anniversary/
// milestone is for and which are still open. Shared by the bell and the daily email.
//
// Recipients: whoever looks after the partner (utils/ownership.js): its care team when it has one, else the
// church's missions team. Everything here counts nothing while the keyDates feature is off.

const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { toUtcDay, DAY_MS } = require("../reporting/definitions");
const { churchToday } = require("./today");
const { upcomingKeyDates, isHandled, reminderTier } = require("./keyDates");
const { careTimings } = require("./careSettings");
const { ownersByPartner } = require("./ownership");

async function keyDatesSettings() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabled = isFeatureEnabled(settings?.enabledFeatures, "keyDates");
  const { keyDateLeadDays, keyDateAdvanceDays } = await careTimings();
  return { enabled, keyDateLeadDays, keyDateAdvanceDays };
}

// Every open key date in the window, each with its recipients. `today` is the current moment (churchToday() reads it in the church's own time zone). Returns [] while the features are off.
//   item: { partnerId, partner:{...}, kind, subjectId, who, occasion, date,
//           daysUntil, turning, recipientIds:[userId], tier }
// `tier` is 0 inside the final window (what the bell and the daily email use); with { withAdvance: true }
// the window reaches out to the earliest advance heads-up (what the digest uses) and `tier` is the threshold.
async function loadOpenKeyDates(today = churchToday(), { withAdvance = false } = {}) {
  const { enabled, keyDateLeadDays, keyDateAdvanceDays } = await keyDatesSettings();
  if (!enabled) return [];
  const day = toUtcDay(today);
  const advance = withAdvance ? keyDateAdvanceDays : [];
  const windowDays = Math.max(keyDateLeadDays, ...advance);

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
      commissionedAt: true,
      adults: { select: { id: true, firstName: true, lastName: true, birthday: true } },
      children: { select: { id: true, firstName: true, lastName: true, birthday: true } },
    },
  });
  const items = upcomingKeyDates(partners, day, windowDays)
    .map((i) => ({ ...i, tier: reminderTier(i.daysUntil, keyDateLeadDays, advance) }))
    .filter((i) => i.tier !== null);
  if (items.length === 0) return [];

  const partnerIds = [...new Set(items.map((i) => i.partnerId))];
  const byId = new Map(partners.map((p) => [p.id, p]));

  // Handled by a "key date" contact log entry within the window of the date.
  const from = new Date(day.getTime() - keyDateLeadDays * DAY_MS);
  const to = new Date(day.getTime() + (windowDays + keyDateLeadDays + 1) * DAY_MS);
  const logs = await prisma.contactLog.findMany({
    where: { partnerId: { in: partnerIds }, topics: { has: "keydate" }, contactDate: { gte: from, lte: to } },
    select: { partnerId: true, topics: true, contactDate: true },
  });
  const logsByPartner = new Map();
  logs.forEach((l) => logsByPartner.set(l.partnerId, [...(logsByPartner.get(l.partnerId) || []), l]));
  const open = items.filter((i) => !isHandled(i, logsByPartner.get(i.partnerId) || []));
  if (open.length === 0) return [];

  // Recipients: whoever looks after the partner (its care team, else the missions team).
  const owners = await ownersByPartner([...new Set(open.map((i) => i.partnerId))]);

  return open
    .map((i) => ({
      ...i,
      partner: byId.get(i.partnerId),
      recipientIds: owners.get(i.partnerId) || [],
    }))
    .filter((i) => i.recipientIds.length > 0);
}

// The open key dates that go to one login.
async function loadOpenKeyDatesFor(userId, today = churchToday(), options) {
  const all = await loadOpenKeyDates(today, options);
  return all.filter((i) => i.recipientIds.includes(userId));
}

module.exports = { loadOpenKeyDates, loadOpenKeyDatesFor, keyDatesSettings };
