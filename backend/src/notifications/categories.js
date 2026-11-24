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
// `scopeTripIds` is null for every full role (no filter) and a guest's
// granted trip ids otherwise (#356) -- only the `tripScoped` categories
// below read it; every other category ignores it.

const prisma = require("../prismaClient");
const { needsReview } = require("../utils/dispatchEligibility");
const { isCareTeamEnabled } = require("../utils/guestAccess");
const { isContactLogEnabled, loadAssignedPartners } = require("../utils/contactLogQueries");
const { loadOpenKeyDatesFor } = require("../utils/keyDateQueries");
const { KEY_DATE_LEAD_DAYS } = require("../utils/keyDates");

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

// #288: partners on this login's care team that nobody has been in touch with
// for CONTACT_STALE_DAYS, or whose follow-up date has come. Counted live from
// the same read model as the My partners tab, so the two always agree.
// Counts nothing while either feature is off. `latest` is when the most
// recent partner became overdue, so the bell only lights up for NEW ones.
async function partnersNeedingContact({ userId }) {
  if (!userId || !(await isContactLogEnabled()) || !(await isCareTeamEnabled())) {
    return { count: 0, latest: null };
  }
  const due = (await loadAssignedPartners(userId)).filter((r) => r.quiet || r.followUpDue);
  const latest = due.reduce((m, r) => {
    const d = r.overdueSince ? new Date(r.overdueSince) : null;
    return d && (!m || d > m) ? d : m;
  }, null);
  return { count: due.length, latest, linkTo: "/admin/partners?assigned=1" };
}

// #291: birthdays, anniversaries and supported-since milestones coming up for
// the partners this login looks after (its care team seats, or -- for a
// partner with no team -- the church's default lead). Live, from the same
// read model as the daily email; one logged "key date" contact clears an item.
// Counts nothing while keyDates or careTeam is off. `latest` is when the most
// recent item became due, so the bell only lights up for NEW ones.
async function keyDatesComing({ userId }) {
  if (!userId) return { count: 0, latest: null };
  const items = await loadOpenKeyDatesFor(userId);
  if (items.length === 0) return { count: 0, latest: null };
  const latest = items.reduce((m, i) => {
    const due = new Date(new Date(`${i.date}T00:00:00Z`).getTime() - KEY_DATE_LEAD_DAYS * 86400000);
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

async function tripsDepartingSoon(_opts, scopeTripIds) {
  const { now, soonBy } = soonWindow();
  const rows = await prisma.trip.findMany({
    where: {
      status: { not: "completed" },
      startDate: { gt: now, lte: soonBy },
      ...(scopeTripIds ? { id: { in: scopeTripIds } } : {}),
    },
    select: { id: true, startDate: true },
  });
  // A generic "/admin/trips" is a dead end for finding which trip --
  // link straight to it whenever exactly one trip is responsible; only
  // fall back to the list when several are (AdminTrips.jsx's own list
  // then needs a per-row indicator, which it has -- see annotateTripFlags
  // in trips.js).
  const linkTo = rows.length === 1 ? `/admin/trips/${rows[0].id}` : undefined;
  return { count: rows.length, latest: latestOf(rows, (r) => r.startDate), linkTo };
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

async function tripsDepartingSoonIncomplete(_opts, scopeTripIds) {
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
  const linkTo = incomplete.length === 1 ? `/admin/trips/${incomplete[0].id}/requirements` : undefined;
  return { count: incomplete.length, latest: latestOf(incomplete, (t) => t.startDate), linkTo };
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

// Per-user count: "how many of these has this teammate not looked at yet,"
// not "how many exist" -- see this file's own header comment.
// `partnerIds`: null for every full role (all partners); a guest's care team
// partners otherwise (#292) -- an empty list counts nothing.
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

// #292: what the church decided or heard that a care team member should pass on
// to the partner -- the app never contacts a partner itself, a person does.
// Two kinds, both in the last UPDATE_WINDOW_DAYS on a partner this login has a
// care team seat on:
//   - a one-time need that was DECIDED (approvedDate): the outcome and the
//     decision note come back to the team to relay;
//   - a prayer request that was ANSWERED: a thank-you or encouragement back.
// An item is done once someone logs an OUTBOUND contact for that partner on or
// after it -- topic "need" for a decision, "encouragement" or "prayer" for an
// answer. (The automatic log a care team member's own answered-prayer entry
// makes is inbound -- the partner told us -- so it doesn't clear its own
// prompt.) Live, so it needs the contact log to be able to clear; counts
// nothing while contactLog or careTeam is off.
const UPDATE_WINDOW_DAYS = 30;

async function updatesToPassOn({ userId }) {
  if (!userId || !(await isContactLogEnabled()) || !(await isCareTeamEnabled())) {
    return { count: 0, latest: null };
  }
  const seats = await prisma.careTeamMember.findMany({
    where: { userId, partner: { archived: false } },
    select: { partnerId: true },
  });
  const partnerIds = seats.map((s) => s.partnerId);
  if (partnerIds.length === 0) return { count: 0, latest: null };

  const today = new Date();
  const since = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - UPDATE_WINDOW_DAYS * 86400000
  );
  const [needs, prayers, logs] = await Promise.all([
    prisma.supportNeed.findMany({
      where: { partnerId: { in: partnerIds }, approvedDate: { gte: since } },
      select: { partnerId: true, approvedDate: true },
    }),
    prisma.prayerRequest.findMany({
      where: { partnerId: { in: partnerIds }, status: "answered", dateAnswered: { gte: since } },
      select: { partnerId: true, dateAnswered: true },
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
  const open = [
    ...needs
      .filter((n) => !relayed(n.partnerId, n.approvedDate, ["need"]))
      .map((n) => ({ partnerId: n.partnerId, date: n.approvedDate })),
    ...prayers
      .filter((p) => !relayed(p.partnerId, p.dateAnswered, ["encouragement", "prayer"]))
      .map((p) => ({ partnerId: p.partnerId, date: p.dateAnswered })),
  ];
  if (open.length === 0) return { count: 0, latest: null };
  const distinct = [...new Set(open.map((o) => o.partnerId))];
  return {
    count: open.length,
    latest: latestOf(open, (o) => o.date),
    linkTo: distinct.length === 1 ? `/admin/partners/${distinct[0]}` : "/admin/partners?assigned=1",
  };
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

// `tripScoped: true` marks the only 4 categories that make sense for a
// guest (role: "guest") -- a scoped login with no visibility into anything
// outside the trips it was granted. Every other category either isn't
// trip-shaped at all (dispatches, emails, prayer requests, admin/system
// health) or spans every trip at once with no per-trip filter -- none of
// that belongs in a guest's own notification list.
const CATEGORIES = [
  {
    key: "dispatchesNeedingApproval",
    label: "Dispatches needing approval",
    icon: "📨",
    linkTo: "/admin/pending-dispatches",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    resolve: dispatchesNeedingApproval,
  },
  {
    key: "unmatchedEmails",
    label: "Unmatched emails",
    icon: "✉️",
    linkTo: "/admin/inbound-email",
    adminOnly: false,
    perUser: false,
    tripScoped: false,
    resolve: unmatchedEmails,
  },
  {
    key: "inboundEmailFailures",
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
    // A care team member's own partners -- the one non-trip category a guest
    // sees (a trip leader has no seats, so the count is always zero for them).
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
    label: "Trips departing soon",
    icon: "✈️",
    linkTo: "/admin/trips",
    adminOnly: false,
    perUser: false,
    tripScoped: true,
    resolve: tripsDepartingSoon,
  },
  {
    key: "tripsDepartingSoonIncomplete",
    label: "Trips departing soon, incomplete",
    icon: "⏳",
    linkTo: "/admin/trips",
    adminOnly: false,
    perUser: false,
    tripScoped: true,
    resolve: tripsDepartingSoonIncomplete,
  },
  {
    key: "overdueTripRequirements",
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
    label: "New prayer requests",
    icon: "🙏",
    linkTo: "/admin/prayer-requests",
    adminOnly: false,
    perUser: true,
    tripScoped: false,
    // A care team guest sees the ones on their own partners (#292).
    guestVisible: true,
    resolve: newPrayerRequests,
  },
  {
    key: "newOneTimeNeeds",
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
    label: "Dispatch send failures",
    icon: "🚫",
    linkTo: "/admin/pending-dispatches",
    adminOnly: true,
    perUser: false,
    tripScoped: false,
    resolve: dispatchSendFailures,
  },
  {
    key: "whatsappConnectionDrop",
    label: "WhatsApp connection dropped",
    icon: "📵",
    linkTo: "/admin/settings/whatsapp",
    adminOnly: true,
    perUser: false,
    tripScoped: false,
    resolve: whatsappConnectionDrop,
  },
];

// Resolves every category this role may see, with per-user seen-state
// already applied -- the one function the route calls.
async function resolveNotificationSummary({ userId, role, scopeTripIds = null, scopePartnerIds = null }) {
  const visible = CATEGORIES.filter((c) => {
    if (c.adminOnly) return role === "admin";
    if (role === "guest") return c.tripScoped || c.guestVisible;
    return true;
  });
  const results = await Promise.all(
    visible.map(async (c) => {
      const { count, latest, linkTo } = await c.resolve({ userId }, scopeTripIds, scopePartnerIds);
      let isNew;
      if (c.perUser) {
        // The count itself is already "new since this user looked" --
        // see this file's header comment.
        isNew = count > 0;
      } else {
        const seenAt = await getSeenAt(userId, c.key);
        isNew = !!latest && (!seenAt || latest > seenAt);
      }
      return { key: c.key, label: c.label, icon: c.icon, linkTo: linkTo || c.linkTo, count, latest, isNew };
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

// For keys outside the bell's own CATEGORIES registry -- the Prayer
// Requests/One-Time Needs list pages' own "new since your last visit to
// this list" row highlighting (":listView" keys, prayerRequests.js/
// supportNeeds.js) reuses this same table under a distinct key so it
// doesn't collide with the bell's own "newPrayerRequests"/
// "newOneTimeNeeds" row. Both rows actually need advancing on a list
// visit now -- the list route calls touchSeen() for its own ":listView"
// key *and* markCategorySeen() for the bell's plain key, since arriving
// here via the sidebar nav badge (not the bell dropdown) is a real path
// and the badge needs to clear either way. They stay two separate rows
// because they answer different questions (which rows are new to show
// vs. is there anything new at all), not because only one of them
// updates on a visit. Never fed a client-supplied category string
// (markCategorySeen above is what the client-facing /seen route uses,
// and its CATEGORIES check is what keeps that one safe) -- only ever
// called with a key the route file itself hardcodes.
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
