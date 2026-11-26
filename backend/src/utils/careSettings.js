// The two timings the care features share, as church settings: days ahead a key
// date is raised, and days without a logged contact that make a partner "quiet".
// One read here so the bell, daily email, My partners tab and report agree.
const prisma = require("../prismaClient");
const { KEY_DATE_LEAD_DAYS } = require("./keyDates");
const { CONTACT_STALE_DAYS } = require("./contactLog");

// What an admin may set (the settings route validates the same bounds).
const KEY_DATE_LEAD_RANGE = { min: 1, max: 60 };
// Earlier heads-ups ride in the digest: up to three, each beyond the final window.
const ADVANCE_DAYS_MAX = 365;
const ADVANCE_DAYS_COUNT = 3;
const DEFAULT_ADVANCE_DAYS = [90, 30];

// Sorted, unique whole numbers in range, later than the final window; anything else is dropped.
function cleanAdvanceDays(value, leadDays) {
  if (!Array.isArray(value)) return DEFAULT_ADVANCE_DAYS.filter((d) => d > leadDays);
  return [...new Set(value)]
    .filter((d) => Number.isInteger(d) && d > leadDays && d <= ADVANCE_DAYS_MAX)
    .sort((a, b) => b - a)
    .slice(0, ADVANCE_DAYS_COUNT);
}

const CONTACT_STALE_RANGE = { min: 7, max: 365 };

const within = (value, { min, max }, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

// { keyDateLeadDays, keyDateAdvanceDays, contactStaleDays } -- the stored values, or the defaults when unset or out of range.
async function careTimings(db = prisma) {
  const row = await db.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { keyDateLeadDays: true, keyDateAdvanceDays: true, contactStaleDays: true },
  });
  const keyDateLeadDays = within(row?.keyDateLeadDays, KEY_DATE_LEAD_RANGE, KEY_DATE_LEAD_DAYS);
  return {
    keyDateLeadDays,
    keyDateAdvanceDays: cleanAdvanceDays(row?.keyDateAdvanceDays, keyDateLeadDays),
    contactStaleDays: within(row?.contactStaleDays, CONTACT_STALE_RANGE, CONTACT_STALE_DAYS),
  };
}

module.exports = {
  careTimings,
  cleanAdvanceDays,
  ADVANCE_DAYS_MAX,
  ADVANCE_DAYS_COUNT,
  KEY_DATE_LEAD_RANGE,
  CONTACT_STALE_RANGE,
};
