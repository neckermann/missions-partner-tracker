// The partner care posts for the church's chat (GroupMe / WhatsApp): a coming key date, a partner nobody has
// heard from, and news waiting to be passed on. A daily run (its own cron among the scheduled jobs) records each as a
// DispatchRecord, and the chat passes post it at the shared chat hour like a prayer request or a need.
//
// Opt-in per type (ChurchSettings.chatDispatchKeyDates / QuietPartners / UpdatesToPass, all off by default),
// and recorded only when a chat channel is on to take it, so Pending Dispatches never fills with posts nobody
// will send. CareChatPost makes each occurrence post once. Never on a public demo (a scheduled send).
const cron = require("./pausableCron");
const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");
const { isDemoInstance } = require("./demoMode");
const { createDispatchRecord } = require("./dispatchRecording");
const { loadOpenKeyDates } = require("./keyDateQueries");
const { loadUpdatesToPassOn } = require("./contactLogQueries");
const { careTimings } = require("./careSettings");
const { toUtcDay, daysBetween } = require("../reporting/definitions");
const { churchToday } = require("./today");

// A first run on a church with many quiet partners posts a few a day, not all at once.
const QUIET_POSTS_PER_RUN = 5;

const ymd = (d) => toUtcDay(d).toISOString().slice(0, 10);
const markerKey = (partnerId, type, subjectKey, date, tier) =>
  `${partnerId}|${type}|${subjectKey}|${ymd(date)}|${tier}`;

async function alreadyPosted(type) {
  const rows = await prisma.careChatPost.findMany({
    where: { type },
    select: { partnerId: true, subjectKey: true, occurrenceDate: true, tier: true },
  });
  return new Set(rows.map((r) => markerKey(r.partnerId, type, r.subjectKey, r.occurrenceDate, r.tier)));
}

// Records the dispatch row, then the marker. A restricted partner whose dispatch is switched off records
// nothing (createDispatchRecord returns null) and is tried again tomorrow.
async function post(type, partner, payload, marker) {
  const row = await createDispatchRecord(type, partner, {
    partnerName: partner.displayName || "",
    ...payload,
  });
  if (!row) return false;
  await prisma.careChatPost.create({
    data: {
      partnerId: partner.id,
      type,
      subjectKey: marker.subjectKey,
      occurrenceDate: toUtcDay(marker.date),
      tier: marker.tier ?? 0,
    },
  });
  return true;
}

async function recordKeyDates(today) {
  const seen = await alreadyPosted("keyDateComing");
  let recorded = 0;
  for (const item of await loadOpenKeyDates(today, { withAdvance: true })) {
    const subjectKey = `${item.kind}:${item.subjectId}`;
    const date = new Date(`${item.date}T00:00:00Z`);
    if (seen.has(markerKey(item.partnerId, "keyDateComing", subjectKey, date, item.tier))) continue;
    const payload = {
      kind: item.kind,
      who: item.who,
      occasion: item.occasion,
      date: item.date,
      daysUntil: item.daysUntil,
      turning: item.turning,
      specialInstructions: item.partner.contactLevel && item.partner.contactLevel !== "normal",
    };
    if (await post("keyDateComing", item.partner, payload, { subjectKey, date, tier: item.tier }))
      recorded += 1;
  }
  return recorded;
}

async function recordQuietPartners(today) {
  const { contactStaleDays } = await careTimings();
  const [partners, lastByPartner, seen] = await Promise.all([
    prisma.partner.findMany({
      where: { archived: false },
      select: { id: true, displayName: true, createdAt: true, contactSnoozedUntil: true },
    }),
    prisma.contactLog.groupBy({ by: ["partnerId"], _max: { contactDate: true } }),
    alreadyPosted("quietPartner"),
  ]);
  const last = new Map(lastByPartner.map((r) => [r.partnerId, r._max.contactDate]));
  // A never-contacted partner's quiet clock starts when they were added, so adding someone isn't an instant nudge.
  const quiet = partners
    .map((p) => ({ partner: p, lastContact: last.get(p.id) || null, since: last.get(p.id) || p.createdAt }))
    .filter((q) => !(q.partner.contactSnoozedUntil && today < q.partner.contactSnoozedUntil))
    .filter((q) => daysBetween(today, q.since) >= contactStaleDays)
    .filter((q) => !seen.has(markerKey(q.partner.id, "quietPartner", "quiet", q.since, 0)))
    .sort((a, b) => a.since - b.since)
    .slice(0, QUIET_POSTS_PER_RUN);

  let recorded = 0;
  for (const q of quiet) {
    const payload = {
      daysQuiet: daysBetween(today, q.since),
      lastContactDate: q.lastContact ? ymd(q.lastContact) : null,
    };
    if (await post("quietPartner", q.partner, payload, { subjectKey: "quiet", date: q.since })) recorded += 1;
  }
  return recorded;
}

async function recordUpdatesToPassOn(today) {
  const partners = await prisma.partner.findMany({
    where: { archived: false },
    select: { id: true, displayName: true },
  });
  const byId = new Map(partners.map((p) => [p.id, p]));
  const items = await loadUpdatesToPassOn([...byId.keys()], today);
  const seen = await alreadyPosted("updateToPassOn");
  let recorded = 0;
  for (const item of items) {
    const subjectKey = `${item.kind}:${item.id}`;
    if (seen.has(markerKey(item.partnerId, "updateToPassOn", subjectKey, item.date, 0))) continue;
    const payload = { kind: item.kind, label: item.label, date: ymd(item.date) };
    if (await post("updateToPassOn", byId.get(item.partnerId), payload, { subjectKey, date: item.date })) {
      recorded += 1;
    }
  }
  return recorded;
}

// `today` is injectable so a run is testable. Returns how many posts were recorded per type.
async function recordCareChatDispatches({ today = churchToday() } = {}) {
  const none = { keyDateComing: 0, quietPartner: 0, updateToPassOn: 0 };
  if (await isDemoInstance()) return none;
  const settings = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  const features = settings?.enabledFeatures;
  // Nowhere to post: record nothing rather than pile up rows no channel will take.
  if (!isFeatureEnabled(features, "groupme") && !isFeatureEnabled(features, "whatsapp")) return none;

  const day = toUtcDay(today);
  const out = { ...none };
  const run = async (type, enabled, fn) => {
    if (!enabled) return;
    try {
      out[type] = await fn(day);
    } catch (err) {
      console.error(`Recording the ${type} chat posts failed:`, err);
    }
  };
  const contactLog = isFeatureEnabled(features, "contactLog");
  await run(
    "keyDateComing",
    settings?.chatDispatchKeyDates === true && isFeatureEnabled(features, "keyDates"),
    recordKeyDates
  );
  await run("quietPartner", settings?.chatDispatchQuietPartners === true && contactLog, recordQuietPartners);
  await run(
    "updateToPassOn",
    settings?.chatDispatchUpdatesToPass === true && contactLog,
    recordUpdatesToPassOn
  );
  return out;
}

function startCareChatDispatchScheduler() {
  // 5:00 church-local, once a day, ahead of the 7:00 key-date email and the chat hour.
  cron.schedule("0 5 * * *", () => recordCareChatDispatches(), {
    name: "care-chat-dispatch",
    noOverlap: true,
  });
}

module.exports = { recordCareChatDispatches, startCareChatDispatchScheduler, QUIET_POSTS_PER_RUN };
