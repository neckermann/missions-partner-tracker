// The in-app notification registry: one declared list of categories, each
// computed live against DB state on every call (cheap at this scale, no caching).
//
// Two intentional count semantics:
// 1. SHARED (most categories): an objective query over unresolved data, the
//    same for every viewer; `resolve()` ignores `userId`. The summary route
//    does the seen-comparison: new = latest > the user's NotificationSeen.seenAt
//    for the category, or everything if no row exists.
// 2. PER-USER ("New Prayer Requests"/"New One-Time Needs"/"Time to check your
//    backups"): nothing is ever "unresolved", so these read NotificationSeen
//    inside resolve(). The backups one is inverted: due when enough time has passed.
//
// `scopeTripIds` is null for full roles and a guest's granted trip ids otherwise;
// only the `tripScoped` categories read it.

const prisma = require("../prismaClient");
const { needsReview } = require("../utils/dispatchEligibility");
const { isCareTeamEnabled } = require("../utils/guestAccess");
const { partnersOwnedBy } = require("../utils/ownership");
const { isFeatureEnabled } = require("../utils/features");
const {
  isContactLogEnabled,
  loadAssignedPartners,
  loadUpdatesToPassOn,
} = require("../utils/contactLogQueries");
const { loadOpenKeyDatesFor } = require("../utils/keyDateQueries");
const { careTimings } = require("../utils/careSettings");
const { READY_SELECT, isOutboundEmailUnfinished } = require("../utils/emailReady");

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

// Partners this login looks after (its care team, or the missions team for partners without one) that nobody
// has contacted within the church's quiet threshold (default 90 days), or whose follow-up date has come. Same
// read model as the My partners tab. Counts nothing while the contact log is off.
// `latest` is when the most recent partner became overdue, so the bell lights up only for NEW ones.
async function partnersNeedingContact({ userId }) {
  if (!userId || !(await isContactLogEnabled())) {
    return { count: 0, latest: null };
  }
  const due = (await loadAssignedPartners(userId)).filter((r) => r.quiet || r.followUpDue);
  const latest = due.reduce((m, r) => {
    const d = r.overdueSince ? new Date(r.overdueSince) : null;
    return d && (!m || d > m) ? d : m;
  }, null);
  return { count: due.length, latest, linkTo: "/admin/partners?assigned=1" };
}

// Upcoming birthdays, anniversaries and supported-since milestones for the
// partners this login looks after (care team seats, or the church's default
// lead for a partner with no team). Same read model as the daily email; one
// logged "key date" contact clears an item. Counts nothing while keyDates or
// careTeam is off. `latest` is when the most recent item became due.
async function keyDatesComing({ userId }) {
  if (!userId) return { count: 0, latest: null };
  const items = await loadOpenKeyDatesFor(userId);
  if (items.length === 0) return { count: 0, latest: null };
  const { keyDateLeadDays } = await careTimings();
  const latest = items.reduce((m, i) => {
    const due = new Date(new Date(`${i.date}T00:00:00Z`).getTime() - keyDateLeadDays * 86400000);
    return !m || due > m ? due : m;
  }, null);
  // One partner: go straight to it; several: the list of my partners.
  const partnerIds = [...new Set(items.map((i) => i.partnerId))];
  return {
    count: items.length,
    latest,
    linkTo: partnerIds.length === 1 ? `/admin/partners/${partnerIds[0]}` : "/admin/partners?assigned=1",
  };
}

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

// Changes survey answers suggest to a partner's record, waiting for a person to decide.
async function surveyUpdatesPending() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const on = isFeatureEnabled(settings?.enabledFeatures, "surveys");
  if (!on) return { count: 0, latest: null };
  const rows = await prisma.surveyProposal.findMany({
    where: { status: "pending" },
    select: { createdAt: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.createdAt) };
}

// Surveys a partner has answered since this login last looked. Per user, and for a care team
// guest only on their own partners. Counts nothing while Surveys is off.
async function newSurveyResponses({ userId }, _scopeTripIds, scopePartnerIds) {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const on = isFeatureEnabled(settings?.enabledFeatures, "surveys");
  if (!on) return { count: 0, latest: null };
  const seenAt = await getSeenAt(userId, "newSurveyResponses");
  const rows = await prisma.surveyResponse.findMany({
    where: {
      submittedAt: seenAt ? { gt: seenAt } : { not: null },
      ...(scopePartnerIds ? { partnerId: { in: scopePartnerIds } } : {}),
    },
    select: { submittedAt: true, partnerId: true },
  });
  const partners = [...new Set(rows.map((r) => r.partnerId))];
  return {
    count: rows.length,
    latest: latestOf(rows, (r) => r.submittedAt),
    linkTo: partners.length === 1 ? `/admin/partners/${partners[0]}` : "/admin/partners",
  };
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

// One alert for trips starting within 30 days. When some of them still have a requirement nobody has met, the
// label says how many, and the link goes straight to that trip's requirements when there is just the one.
async function tripsDepartingSoon(_opts, scopeTripIds) {
  const { now, soonBy } = soonWindow();
  const trips = await prisma.trip.findMany({
    where: {
      status: { not: "completed" },
      startDate: { gt: now, lte: soonBy },
      ...(scopeTripIds ? { id: { in: scopeTripIds } } : {}),
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
  // Link straight to the trip when exactly one is responsible; otherwise the list.
  let linkTo;
  if (trips.length === 1) {
    linkTo =
      incomplete.length === 1 ? `/admin/trips/${trips[0].id}/requirements` : `/admin/trips/${trips[0].id}`;
  } else if (incomplete.length === 1) {
    linkTo = `/admin/trips/${incomplete[0].id}/requirements`;
  }
  return {
    count: trips.length,
    latest: latestOf(trips, (r) => r.startDate),
    linkTo,
    label:
      incomplete.length > 0 ? `Trips departing soon (${incomplete.length} missing something)` : undefined,
  };
}

// A trip whose end date has passed and isn't marked completed. For a trip leader
// it is their own trip (scopeTripIds); linked to the trip when there is one.
async function tripsReadyToWrapUp(_opts, scopeTripIds) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await prisma.trip.findMany({
    where: {
      status: { not: "completed" },
      endDate: { lt: today },
      ...(scopeTripIds ? { id: { in: scopeTripIds } } : {}),
    },
    select: { id: true, endDate: true },
  });
  const linkTo = rows.length === 1 ? `/admin/trips/${rows[0].id}` : undefined;
  return { count: rows.length, latest: latestOf(rows, (r) => r.endDate), linkTo };
}

// A trip wrapped up in the last two weeks, for the partner's care team (the
// debrief is useful before the next contact). Counts nothing while trips or care
// teams are off, and only partners this login holds a seat on.
const WRAPPED_UP_WINDOW_DAYS = 14;
async function tripsWrappedUp({ userId }) {
  if (!userId || !(await isCareTeamEnabled())) return { count: 0, latest: null };
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  if (!isFeatureEnabled(settings?.enabledFeatures, "trips")) return { count: 0, latest: null };
  const seats = await prisma.careTeamMember.findMany({
    where: { userId, partner: { archived: false } },
    select: { partnerId: true },
  });
  if (seats.length === 0) return { count: 0, latest: null };
  const since = new Date(Date.now() - WRAPPED_UP_WINDOW_DAYS * 86400000);
  const rows = await prisma.trip.findMany({
    where: { partnerId: { in: seats.map((s) => s.partnerId) }, wrappedUpAt: { gte: since } },
    select: { id: true, wrappedUpAt: true },
  });
  const linkTo = rows.length === 1 ? `/admin/trips/${rows[0].id}` : undefined;
  return { count: rows.length, latest: latestOf(rows, (r) => r.wrappedUpAt), linkTo };
}

// Fulfilled the same way tripReminderScheduler.js decides it: a "task" row by its
// TripRequirementStatus.completedAt; "document"/"esignature" by any matching
// TripDocument (completedAt stays null for those kinds by design).
function isRequirementFulfilledForParticipant(requirement, participantId, documents) {
  if (requirement.kind === "task") {
    const status = requirement.requirementStatuses.find((s) => s.participantId === participantId);
    return !!status?.completedAt;
  }
  return documents.some((d) => d.participantId === participantId);
}

async function overdueTripRequirements(_opts, scopeTripIds) {
  const now = new Date();
  const requirements = await prisma.tripRequirement.findMany({
    where: { dueAt: { lt: now }, ...(scopeTripIds ? { tripId: { in: scopeTripIds } } : {}) },
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
  const distinctTripIds = new Set(overdueItems.map((r) => r.tripId));
  const linkTo =
    distinctTripIds.size === 1 ? `/admin/trips/${overdueItems[0].tripId}/requirements` : undefined;
  return { count: overdueItems.length, latest: latestOf(overdueItems, (r) => r.dueAt), linkTo };
}

async function tripApplicationsPending(_opts, scopeTripIds) {
  const rows = await prisma.tripApplication.findMany({
    where: { status: "pending", ...(scopeTripIds ? { tripId: { in: scopeTripIds } } : {}) },
    select: { tripId: true, createdAt: true },
  });
  const distinctTripIds = new Set(rows.map((r) => r.tripId));
  const linkTo = distinctTripIds.size === 1 ? `/admin/trips/${rows[0].tripId}/team` : undefined;
  return { count: rows.length, latest: latestOf(rows, (r) => r.createdAt), linkTo };
}

// Per-user count: how many this teammate hasn't looked at yet (see header).
// `partnerIds`: null for full roles; a guest's care team partners otherwise. Empty counts nothing.
async function newRowsSince(model, userId, category, partnerIds = null) {
  const seenAt = await getSeenAt(userId, category);
  const rows = await prisma[model].findMany({
    where: {
      ...(seenAt ? { createdAt: { gt: seenAt } } : {}),
      ...(partnerIds ? { partnerId: { in: partnerIds } } : {}),
    },
    select: { createdAt: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.createdAt) };
}

async function newPrayerRequests({ userId }, _scopeTripIds, scopePartnerIds) {
  return newRowsSince("prayerRequest", userId, "newPrayerRequests", scopePartnerIds);
}

async function newOneTimeNeeds({ userId }, _scopeTripIds, scopePartnerIds) {
  return newRowsSince("supportNeed", userId, "newOneTimeNeeds", scopePartnerIds);
}

// What the church decided or heard that a care team member should pass on (the
// app never contacts a partner itself). Within UPDATE_WINDOW_DAYS, on a partner
// this login looks after (a care team seat, or the missions team for a partner with no team):
//   - a one-time need that was DECIDED (approvedDate): relay the outcome and note;
//   - a prayer request that was ANSWERED: send thanks or encouragement.
// An item is done once someone logs an OUTBOUND contact for that partner on or
// after it (topic "need" for a decision, "encouragement" or "prayer" for an
// answer). A care team member's own answered-prayer entry is inbound, so it
// doesn't clear its own prompt. Counts nothing while the contact log is off.
async function updatesToPassOn({ userId }) {
  if (!userId || !(await isContactLogEnabled())) {
    return { count: 0, latest: null };
  }
  const partnerIds = (await partnersOwnedBy(userId)).map((o) => o.partnerId);
  if (partnerIds.length === 0) return { count: 0, latest: null };

  const open = await loadUpdatesToPassOn(partnerIds);
  if (open.length === 0) return { count: 0, latest: null };
  const distinct = [...new Set(open.map((o) => o.partnerId))];
  return {
    count: open.length,
    latest: latestOf(open, (o) => o.date),
    linkTo: distinct.length === 1 ? `/admin/partners/${distinct[0]}` : "/admin/partners?assigned=1",
  };
}

// Email (Sending) is switched on but no mail account / sender address has been entered, so nothing can be
// sent. Everything that would have emailed falls back (copy-link, "not sent") until this is finished.
async function emailNotFinished() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: READY_SELECT,
  });
  const unfinished = isOutboundEmailUnfinished(settings);
  return { count: unfinished ? 1 : 0, latest: unfinished ? new Date() : null };
}

async function adminMfaDisabled() {
  const rows = await prisma.user.findMany({
    where: { role: "admin", active: true, mfaEnabled: false },
    select: { createdAt: true },
  });
  return { count: rows.length, latest: latestOf(rows, (r) => r.createdAt) };
}

// Inverted semantics: due when time has elapsed, not when something changed.
// Reuses BackupReminder.jsx's detection (provider + backupReminderDisabled), with
// the snooze stored per user in NotificationSeen so it follows them across devices.
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
    where: {
      OR: [{ groupmeError: { not: null } }, { whatsappError: { not: null } }, { emailError: { not: null } }],
    },
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

// `tripScoped: true` marks the only categories meaningful for a guest (a scoped
// login with no visibility outside its granted trips); the rest aren't
// trip-shaped or span every trip.
const CATEGORIES = [
  {
    key: "dispatchesNeedingApproval",
    requiresAny: ["groupme", "whatsapp", "outboundEmail"],
    label: "Updates waiting for your OK",
    icon: "📨",
    linkTo: "/admin/pending-dispatches",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    resolve: dispatchesNeedingApproval,
  },
  {
    key: "unmatchedEmails",
    requiresAny: ["inboundEmail"],
    label: "Emails to Sort",
    icon: "✉️",
    linkTo: "/admin/inbound-email",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    resolve: unmatchedEmails,
  },
  {
    key: "surveyUpdatesPending",
    requiresAny: ["surveys"],
    label: "Survey updates to review",
    icon: "📝",
    linkTo: "/admin/survey-updates",
    // Only people who can approve a change see it.
    roles: ["admin", "editor"],
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    resolve: surveyUpdatesPending,
  },
  {
    key: "newSurveyResponses",
    requiresAny: ["surveys"],
    label: "New survey answers",
    icon: "📋",
    linkTo: "/admin/partners",
    adminOnly: false,
    perUser: true,
    tripScoped: false,
    // A care team guest sees the ones on their own partners.
    guestVisible: true,
    resolve: newSurveyResponses,
  },
  {
    key: "inboundEmailFailures",
    requiresAny: ["inboundEmail"],
    label: "Inbound email errors",
    icon: "⚠️",
    linkTo: "/admin/inbound-email",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    resolve: inboundEmailFailures,
  },
  {
    key: "partnersNeedingContact",
    label: "Partners to reach out to",
    icon: "💬",
    linkTo: "/admin/partners?assigned=1",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    // A care team member's own partners: the one non-trip category a guest sees (zero for a trip leader).
    guestVisible: true,
    resolve: partnersNeedingContact,
  },
  {
    key: "keyDatesComing",
    label: "Key dates coming up",
    icon: "🎂",
    linkTo: "/admin/partners?assigned=1",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    // Visible to a care team guest, like partnersNeedingContact above.
    guestVisible: true,
    resolve: keyDatesComing,
  },
  {
    key: "tripsDepartingSoon",
    requiresAny: ["trips"],
    label: "Trips departing soon",
    icon: "✈️",
    linkTo: "/admin/trips",
    adminOnly: false,
    perUser: false,
    tripScoped: true,
    resolve: tripsDepartingSoon,
  },
  {
    key: "tripsReadyToWrapUp",
    requiresAny: ["trips"],
    label: "Trips ready to wrap up",
    icon: "🏁",
    linkTo: "/admin/trips",
    adminOnly: false,
    perUser: false,
    tripScoped: true,
    resolve: tripsReadyToWrapUp,
  },
  {
    key: "tripsWrappedUp",
    requiresAny: ["trips"],
    label: "Trips wrapped up",
    icon: "📝",
    linkTo: "/admin/trips",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    guestVisible: true,
    resolve: tripsWrappedUp,
  },
  {
    key: "overdueTripRequirements",
    requiresAny: ["trips"],
    label: "Overdue trip requirements",
    icon: "⏰",
    linkTo: "/admin/trips",
    adminOnly: false,
    perUser: false,
    tripScoped: true,
    resolve: overdueTripRequirements,
  },
  {
    key: "tripApplicationsPending",
    requiresAny: ["trips"],
    label: "Trip applications pending review",
    icon: "📝",
    linkTo: "/admin/trips",
    adminOnly: false,
    perUser: false,
    tripScoped: true,
    resolve: tripApplicationsPending,
  },
  {
    key: "newPrayerRequests",
    requiresAny: ["prayerRequests"],
    label: "New prayer requests",
    icon: "🙏",
    linkTo: "/admin/prayer-requests",
    adminOnly: false,
    perUser: true,
    tripScoped: false,
    // A care team guest sees the ones on their own partners.
    guestVisible: true,
    resolve: newPrayerRequests,
  },
  {
    key: "newOneTimeNeeds",
    requiresAny: ["oneTimeNeeds"],
    label: "New one-time needs",
    icon: "💝",
    linkTo: "/admin/support/needs",
    adminOnly: false,
    perUser: true,
    tripScoped: false,
    guestVisible: true,
    resolve: newOneTimeNeeds,
  },
  {
    key: "updatesToPassOn",
    label: "Updates to pass on to partners",
    icon: "📣",
    linkTo: "/admin/partners?assigned=1",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    guestVisible: true,
    resolve: updatesToPassOn,
  },
  {
    key: "emailNotFinished",
    label: "Email isn't finished setting up",
    icon: "✉️",
    linkTo: "/admin/settings/email",
    adminOnly: true,
    perUser: false,
    tripScoped: false,
    resolve: emailNotFinished,
  },
  {
    key: "adminMfaDisabled",
    label: "Admin account missing MFA",
    icon: "🔐",
    linkTo: "/admin/settings/users",
    adminOnly: true,
    perUser: false,
    tripScoped: false,
    resolve: adminMfaDisabled,
  },
  {
    key: "timeToCheckBackups",
    label: "Time to check your backups",
    icon: "💾",
    linkTo: "/admin/settings/system-info",
    adminOnly: true,
    perUser: true,
    tripScoped: false,
    resolve: timeToCheckBackups,
  },
  {
    key: "dispatchSendFailures",
    requiresAny: ["groupme", "whatsapp", "outboundEmail"],
    label: "Updates that didn't send",
    icon: "🚫",
    linkTo: "/admin/pending-dispatches",
    adminOnly: true,
    perUser: false,
    tripScoped: false,
    resolve: dispatchSendFailures,
  },
  {
    key: "whatsappConnectionDrop",
    requiresAny: ["whatsapp"],
    label: "WhatsApp connection dropped",
    icon: "📵",
    linkTo: "/admin/settings/whatsapp",
    adminOnly: true,
    perUser: false,
    tripScoped: false,
    resolve: whatsappConnectionDrop,
  },
];

// Resolves every category this role may see with per-user seen-state applied; the one function the route calls.
async function resolveNotificationSummary({ userId, role, scopeTripIds = null, scopePartnerIds = null }) {
  // A category whose page is switched off is not shown at all: its link would only say "This feature is turned off".
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const visible = CATEGORIES.filter((c) => {
    if (c.requiresAny && !c.requiresAny.some((f) => isFeatureEnabled(settings?.enabledFeatures, f)))
      return false;
    if (c.roles && !c.roles.includes(role)) return false;
    if (c.adminOnly) return role === "admin";
    if (role === "guest") return c.tripScoped || c.guestVisible;
    return true;
  });
  const results = await Promise.all(
    visible.map(async (c) => {
      const { count, latest, linkTo, label } = await c.resolve({ userId }, scopeTripIds, scopePartnerIds);
      let isNew;
      if (c.perUser) {
        // The count is already "new since this user looked".
        isNew = count > 0;
      } else {
        const seenAt = await getSeenAt(userId, c.key);
        isNew = !!latest && (!seenAt || latest > seenAt);
      }
      return {
        key: c.key,
        label: label || c.label,
        icon: c.icon,
        linkTo: linkTo || c.linkTo,
        count,
        latest,
        isNew,
      };
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

// For keys outside the bell's CATEGORIES: the Prayer Requests/One-Time Needs
// list pages' ":listView" keys (new-row highlighting) share this table under a
// distinct key. A list visit advances both rows (touchSeen for ":listView",
// markCategorySeen for the bell key) since the sidebar badge must clear too;
// they stay separate because they answer different questions. Only ever called
// with a key the route file hardcodes, never a client-supplied string
// (markCategorySeen's CATEGORIES check keeps the client-facing /seen route safe).
async function touchSeen(userId, category) {
  if (!userId) return;
  await prisma.notificationSeen.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category },
    update: { seenAt: new Date() },
  });
}

module.exports = {
  CATEGORIES,
  SOON_DAYS,
  resolveNotificationSummary,
  markCategorySeen,
  getSeenAt,
  touchSeen,
  isRequirementFulfilledForParticipant,
};
