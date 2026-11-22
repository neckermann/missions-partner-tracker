// The in-app notification registry -- one declared list of categories
// instead of a growing pile of ad hoc frontend checks (the old
// useNeedsAttention() hook's problem: it could only answer "what does this
// page already have fetched," not a real cross-trip/cross-partner count).
// Each category is computed live against real DB state here, backend-side,
// on every call -- cheap at this app's scale, no caching needed.
//
// Two different count semantics exist, both intentional, not a bug:
//
// 1. SHARED count (most categories): an objective, live query against
//    unresolved real data -- how many dispatches actually still need
//    approval, how many emails are actually still unmatched. Identical for
//    every viewer regardless of who's asking; drops the moment anyone
//    resolves the underlying item. `resolve()` ignores `userId` for these.
//
// 2. PER-USER count ("New Prayer Requests"/"New One-Time Needs"/"Time to
//    check your backups"): there's no "unresolved" state to query --
//    a prayer request doesn't get resolved, it just exists. The only
//    meaningful count here is "how many (or whether) this specific user
//    hasn't seen yet," so these categories read NotificationSeen
//    themselves inside resolve() rather than leaving the seen-comparison
//    to the caller. "Time to check your backups" is further inverted: due
//    for a nudge when enough time has passed, not when new data arrived.
//
// For every other (shared) category, the caller (the summary route) does
// the seen-comparison itself: new = latest > (that user's NotificationSeen
// row for this category).seenAt, or everything is new if no row exists yet.
//
// `scopeTripId`, accepted by every resolve() but unused by all of them
// today, is reserved for the Trip Leader guest role (a separate, not-yet-
// landed plan) -- a no-op for every current role, a hard filter once that
// role exists. Keeping the parameter here now means that future work is
// "pass a value," not "add a parameter to every category."

const prisma = require("../prismaClient");
const { needsReview } = require("../utils/dispatchEligibility");

const SOON_DAYS = 30;
const BACKUP_REMIND_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function latestOf(rows, pick) {
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => {
    const value = pick(row);
    return !latest || (value && value > latest) ? value : latest;
  }, null);
}

async function getSeenAt(userId, category) {
  if (!userId) return null;
  const row = await prisma.notificationSeen.findUnique({
    where: { userId_category: { userId, category } },
  });
  return row?.seenAt ?? null;
}

// --- All-roles categories --------------------------------------------

async function dispatchesNeedingApproval() {
  const rows = await prisma.dispatchRecord.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { count: 0, latest: null };
  const partners = await prisma.partner.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.partnerId))] } },
    select: { id: true, isRestricted: true },
  });
  const partnerById = new Map(partners.map((p) => [p.id, p]));
  const held = rows.filter((r) => needsReview(r, partnerById.get(r.partnerId)));
  return { count: held.length, latest: latestOf(held, (r) => r.createdAt) };
}

async function unmatchedEmails() {
  const rows = await prisma.inboundEmail.findMany({ select: { receivedAt: true } });
  return { count: rows.length, latest: latestOf(rows, (r) => r.receivedAt) };
}

async function inboundEmailFailures() {
  const rows = await prisma.inboundEmailFailure.findMany({ select: { receivedAt: true } });
  return { count: rows.length, latest: latestOf(rows, (r) => r.receivedAt) };
}

function soonWindow() {
  const now = new Date();
  const soonBy = new Date(now.getTime() + SOON_DAYS * 24 * 60 * 60 * 1000);
  return { now, soonBy };
}

async function tripsDepartingSoon(_opts, scopeTripId) {
  const { now, soonBy } = soonWindow();
  const rows = await prisma.trip.findMany({
    where: {
      status: { not: "completed" },
      startDate: { gt: now, lte: soonBy },
      ...(scopeTripId ? { id: scopeTripId } : {}),
    },
    select: { id: true, startDate: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.startDate) };
}

// A requirement is fulfilled the same way tripReminderScheduler.js already
// decides it, not a separate reinvented rule: a "task"-kind row is
// fulfilled by its own TripRequirementStatus.completedAt; "document"/
// "esignature" kinds are fulfilled by a matching TripDocument existing at
// all (completedAt stays permanently null for those kinds by design).
function isRequirementFulfilledForParticipant(requirement, participantId, documents) {
  if (requirement.kind === "task") {
    const status = requirement.requirementStatuses.find((s) => s.participantId === participantId);
    return !!status?.completedAt;
  }
  return documents.some((d) => d.participantId === participantId);
}

async function tripsDepartingSoonIncomplete(_opts, scopeTripId) {
  const { now, soonBy } = soonWindow();
  const trips = await prisma.trip.findMany({
    where: {
      status: { not: "completed" },
      startDate: { gt: now, lte: soonBy },
      ...(scopeTripId ? { id: scopeTripId } : {}),
    },
    include: {
      participants: { select: { id: true } },
      requirements: { include: { requirementStatuses: true, documents: true } },
    },
  });
  const incomplete = trips.filter((trip) =>
    trip.participants.some((participant) =>
      trip.requirements.some(
        (req) => !isRequirementFulfilledForParticipant(req, participant.id, req.documents)
      )
    )
  );
  return { count: incomplete.length, latest: latestOf(incomplete, (t) => t.startDate) };
}

async function overdueTripRequirements(_opts, scopeTripId) {
  const now = new Date();
  const requirements = await prisma.tripRequirement.findMany({
    where: { dueAt: { lt: now }, ...(scopeTripId ? { tripId: scopeTripId } : {}) },
    include: {
      trip: { select: { participants: { select: { id: true } } } },
      requirementStatuses: true,
      documents: true,
    },
  });
  const overdueItems = [];
  for (const req of requirements) {
    for (const participant of req.trip.participants) {
      if (!isRequirementFulfilledForParticipant(req, participant.id, req.documents)) {
        overdueItems.push(req);
        break; // one overdue participant is enough to count this requirement once
      }
    }
  }
  return { count: overdueItems.length, latest: latestOf(overdueItems, (r) => r.dueAt) };
}

async function tripApplicationsPending(_opts, scopeTripId) {
  const rows = await prisma.tripApplication.findMany({
    where: { status: "pending", ...(scopeTripId ? { tripId: scopeTripId } : {}) },
    select: { submittedAt: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.submittedAt) };
}

// Per-user count: "how many of these has this teammate not looked at yet,"
// not "how many exist" -- see this file's own header comment.
async function newRowsSince(model, userId, category) {
  const seenAt = await getSeenAt(userId, category);
  const rows = await prisma[model].findMany({
    where: seenAt ? { createdAt: { gt: seenAt } } : {},
    select: { createdAt: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.createdAt) };
}

async function newPrayerRequests({ userId }) {
  return newRowsSince("prayerRequest", userId, "newPrayerRequests");
}

async function newOneTimeNeeds({ userId }) {
  return newRowsSince("supportNeed", userId, "newOneTimeNeeds");
}

// --- Admin-only categories ---------------------------------------------

async function adminMfaDisabled() {
  const rows = await prisma.user.findMany({
    where: { role: "admin", active: true, mfaEnabled: false },
    select: { createdAt: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.createdAt) };
}

// Inverted semantics, deliberately: "due for a nudge" (time elapsed),
// not "something changed." Reuses BackupReminder.jsx's own detection
// (provider + backupReminderDisabled), migrated off that component's old
// per-browser localStorage snooze onto this same per-user NotificationSeen
// table, so it isn't lost across devices.
async function timeToCheckBackups({ userId }) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { backupReminderDisabled: true },
  });
  if (settings?.backupReminderDisabled) return { count: 0, latest: null };
  const seenAt = await getSeenAt(userId, "timeToCheckBackups");
  const due = !seenAt || Date.now() - seenAt.getTime() >= BACKUP_REMIND_AGAIN_AFTER_MS;
  return { count: due ? 1 : 0, latest: due ? new Date() : null };
}

async function dispatchSendFailures() {
  const rows = await prisma.dispatchRecord.findMany({
    where: { OR: [{ groupmeError: { not: null } }, { whatsappError: { not: null } }, { emailError: { not: null } }] },
    select: { createdAt: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.createdAt) };
}

async function whatsappConnectionDrop() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { whatsappPairedAt: true, whatsappDisconnectedAt: true },
  });
  const dropped = !!settings?.whatsappPairedAt && !!settings?.whatsappDisconnectedAt;
  return { count: dropped ? 1 : 0, latest: dropped ? settings.whatsappDisconnectedAt : null };
}

const CATEGORIES = [
  { key: "dispatchesNeedingApproval", label: "Dispatches needing approval", icon: "📨", linkTo: "/admin/dispatches", adminOnly: false, perUser: false, resolve: dispatchesNeedingApproval },
  { key: "unmatchedEmails", label: "Unmatched emails", icon: "✉️", linkTo: "/admin/inbound-email", adminOnly: false, perUser: false, resolve: unmatchedEmails },
  { key: "inboundEmailFailures", label: "Inbound email errors", icon: "⚠️", linkTo: "/admin/inbound-email", adminOnly: false, perUser: false, resolve: inboundEmailFailures },
  { key: "tripsDepartingSoon", label: "Trips departing soon", icon: "✈️", linkTo: "/admin/trips", adminOnly: false, perUser: false, resolve: tripsDepartingSoon },
  { key: "tripsDepartingSoonIncomplete", label: "Trips departing soon, incomplete", icon: "⏳", linkTo: "/admin/trips", adminOnly: false, perUser: false, resolve: tripsDepartingSoonIncomplete },
  { key: "overdueTripRequirements", label: "Overdue trip requirements", icon: "⏰", linkTo: "/admin/trips", adminOnly: false, perUser: false, resolve: overdueTripRequirements },
  { key: "tripApplicationsPending", label: "Trip applications pending review", icon: "📝", linkTo: "/admin/trips", adminOnly: false, perUser: false, resolve: tripApplicationsPending },
  { key: "newPrayerRequests", label: "New prayer requests", icon: "🙏", linkTo: "/admin/prayer-requests", adminOnly: false, perUser: true, resolve: newPrayerRequests },
  { key: "newOneTimeNeeds", label: "New one-time needs", icon: "💝", linkTo: "/admin/one-time-needs", adminOnly: false, perUser: true, resolve: newOneTimeNeeds },
  { key: "adminMfaDisabled", label: "Admin account missing MFA", icon: "🔐", linkTo: "/admin/settings/users", adminOnly: true, perUser: false, resolve: adminMfaDisabled },
  { key: "timeToCheckBackups", label: "Time to check your backups", icon: "💾", linkTo: "/admin/settings/system-info", adminOnly: true, perUser: true, resolve: timeToCheckBackups },
  { key: "dispatchSendFailures", label: "Dispatch send failures", icon: "🚫", linkTo: "/admin/dispatches", adminOnly: true, perUser: false, resolve: dispatchSendFailures },
  { key: "whatsappConnectionDrop", label: "WhatsApp connection dropped", icon: "📵", linkTo: "/admin/settings/whatsapp", adminOnly: true, perUser: false, resolve: whatsappConnectionDrop },
];

// Resolves every category this role may see, with per-user seen-state
// already applied -- the one function the route calls.
async function resolveNotificationSummary({ userId, role, scopeTripId = null }) {
  const visible = CATEGORIES.filter((c) => (c.adminOnly ? role === "admin" : true));
  const results = await Promise.all(
    visible.map(async (c) => {
      const { count, latest } = await c.resolve({ userId }, scopeTripId);
      let isNew;
      if (c.perUser) {
        // The count itself is already "new since this user looked" --
        // see this file's header comment.
        isNew = count > 0;
      } else {
        const seenAt = await getSeenAt(userId, c.key);
        isNew = !!latest && (!seenAt || latest > seenAt);
      }
      return { key: c.key, label: c.label, icon: c.icon, linkTo: c.linkTo, count, latest, isNew };
    })
  );
  return results;
}

async function markCategorySeen(userId, category) {
  if (!CATEGORIES.some((c) => c.key === category)) return;
  await prisma.notificationSeen.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category },
    update: { seenAt: new Date() },
  });
}

module.exports = {
  CATEGORIES,
  resolveNotificationSummary,
  markCategorySeen,
  isRequirementFulfilledForParticipant,
};
