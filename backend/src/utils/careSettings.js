// #365: the two timings the care features share, now church settings instead of fixed numbers:
// how many days ahead a key date is raised, and how many days without a logged contact make a
// partner "quiet". One read here, so the bell, the daily email, the My partners tab and the
// report can never use different numbers. Defaults are the old fixed values.
const prisma = require("../prismaClient");
const { KEY_DATE_LEAD_DAYS } = require("./keyDates");
const { CONTACT_STALE_DAYS } = require("./contactLog");

// What an admin may set (the settings route validates the same bounds).
const KEY_DATE_LEAD_RANGE = { min: 1, max: 60 };
const CONTACT_STALE_RANGE = { min: 7, max: 365 };

const within = (value, { min, max }, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

// { keyDateLeadDays, contactStaleDays } -- the stored values, or the defaults when unset or out of range.
async function careTimings(db = prisma) {
  const row = await db.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { keyDateLeadDays: true, contactStaleDays: true },
  });
  return {
    keyDateLeadDays: within(row?.keyDateLeadDays, KEY_DATE_LEAD_RANGE, KEY_DATE_LEAD_DAYS),
    contactStaleDays: within(row?.contactStaleDays, CONTACT_STALE_RANGE, CONTACT_STALE_DAYS),
  };
}

module.exports = { careTimings, KEY_DATE_LEAD_RANGE, CONTACT_STALE_RANGE };
