// The Sunday prayer sheet: one printable page (or a slide per partner) of what to pray for, built for handing out.
//
// Who may appear is the public site's rule, not the admin list's: a partner that is public, not archived and not
// restricted, and only its requests that are strategic, explicitly public and still ongoing. Private requests, a
// restricted partner and anything situational never print.
//
// Which partners appear on a given sheet rotates, so everyone is prayed for about once a month however often the
// church makes a sheet:
//   weekly    a sheet every week, a quarter of the partners on each
//   biweekly  a sheet every two weeks, half of the partners on each
//   monthly   a sheet once a month, every partner on it
// The group is worked out from the date alone (no stored state), so the same date always gives the same sheet.
const prisma = require("../prismaClient");

const CADENCES = {
  weekly: { groups: 4, daysPerSheet: 7 },
  biweekly: { groups: 2, daysPerSheet: 14 },
  monthly: { groups: 1, daysPerSheet: 28 },
};
const CADENCE_KEYS = Object.keys(CADENCES);
const DEFAULT_PER_PARTNER = 3;
const MAX_PER_PARTNER = 5;

// A Sunday, the start of every rotation. Anything works as long as it never changes.
const EPOCH_UTC = Date.UTC(2026, 0, 4);
const DAY_MS = 24 * 60 * 60 * 1000;

const mod = (n, m) => ((n % m) + m) % m;

// Which group of partners belongs on the sheet for `ymd` (a yyyy-mm-dd string), and how many groups there are.
function sheetGroup(ymd, cadence) {
  const spec = CADENCES[cadence];
  if (!spec) throw new Error(`Unknown cadence: ${cadence}`);
  if (spec.groups === 1) return { index: 0, count: 1 };
  const [y, m, d] = String(ymd).split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
  const sheetNumber = Math.floor(days / spec.daysPerSheet);
  return { index: mod(sheetNumber, spec.groups), count: spec.groups };
}

// `partners` in any order; they are sorted by name here so the same list always splits the same way. Partner i
// goes to group i % count, so the groups are as even as they can be.
function partnersForGroup(partners, group) {
  const sorted = [...partners].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id)
  );
  return sorted.filter((_, i) => i % group.count === group.index);
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function isValidDay(ymd) {
  if (!dayPattern.test(String(ymd))) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Partners that could ever appear, with the requests that may be shown, newest first. Partners with nothing to pray
// for are left out before the rotation, so every sheet has something on it.
async function eligiblePartners({ perPartner = DEFAULT_PER_PARTNER, db = prisma } = {}) {
  const partners = await db.partner.findMany({
    where: { isPublic: true, archived: false, isRestricted: false },
    select: {
      id: true,
      displayName: true,
      kind: true,
      addresses: { where: { type: "physical" }, select: { country: true } },
      prayerRequests: {
        where: { category: "strategic", isPublic: true, status: "ongoing" },
        orderBy: [{ dateReceived: "desc" }, { createdAt: "desc" }],
        select: { id: true, requestText: true, dateReceived: true },
      },
    },
  });
  return partners
    .filter((p) => p.prayerRequests.length > 0)
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      kind: p.kind,
      country: p.addresses[0]?.country || null,
      requests: p.prayerRequests.slice(0, perPartner).map((r) => ({ id: r.id, text: r.requestText })),
      moreRequests: Math.max(0, p.prayerRequests.length - perPartner),
    }));
}

async function buildPrayerSheet({ date, cadence = "weekly", perPartner = DEFAULT_PER_PARTNER, db = prisma }) {
  const all = await eligiblePartners({ perPartner, db });
  const group = sheetGroup(date, cadence);
  return {
    date,
    cadence,
    group,
    totalPartners: all.length,
    partners: partnersForGroup(all, group),
  };
}

module.exports = {
  CADENCES,
  CADENCE_KEYS,
  DEFAULT_PER_PARTNER,
  MAX_PER_PARTNER,
  sheetGroup,
  partnersForGroup,
  isValidDay,
  eligiblePartners,
  buildPrayerSheet,
};
