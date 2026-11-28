// Who looks after a partner: the one rule every "which partners are mine?" and "who gets this reminder?"
// feature uses (key-date reminders, My partners, the reach-out and updates-to-pass-on alerts).
//
//   1. The partner's own care team (its active members who have signed in at least once), when Care teams is on
//      and the partner has one. A person who was only invited, and has not yet signed in, cannot see or act on
//      a reminder, so until they do the partner's reminders stay with the missions team.
//   2. Otherwise the church's missions team: every active, non-guest login with onMissionsTeam.
//
// A church that never turns Care teams on is simply the second case for every partner. The group's name is
// church wording (ChurchSettings.ownerGroupName); nothing here depends on it.

const prisma = require("../prismaClient");
const { isFeatureEnabled } = require("./features");

// A care team seat that can act on reminders: an active login that has signed in. A pending invite (no
// sign-in yet) holds the seat but does not take reminders away from the missions team.
const ACTIVE_CARER = { active: true, lastLoginAt: { not: null } };

async function careTeamsOn() {
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  return isFeatureEnabled(settings?.enabledFeatures, "careTeam");
}

// The missions team: active logins marked onMissionsTeam. A guest is never one, even if the flag was set
// before they were made a guest.
async function missionsTeamIds() {
  const rows = await prisma.user.findMany({
    where: { onMissionsTeam: true, active: true, role: { not: "guest" } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// The partner's own team: Map(partnerId -> [userId]) of active members who have signed in, empty when Care teams is off.
async function careTeamsByPartner(partnerIds) {
  const map = new Map();
  if (partnerIds.length === 0 || !(await careTeamsOn())) return map;
  const seats = await prisma.careTeamMember.findMany({
    where: { partnerId: { in: partnerIds }, user: ACTIVE_CARER },
    select: { partnerId: true, userId: true },
  });
  seats.forEach((s) => map.set(s.partnerId, [...(map.get(s.partnerId) || []), s.userId]));
  return map;
}

// Map(partnerId -> [userId]): who looks after each of these partners.
async function ownersByPartner(partnerIds) {
  const [teams, missions] = await Promise.all([careTeamsByPartner(partnerIds), missionsTeamIds()]);
  return new Map(partnerIds.map((id) => [id, teams.get(id) || missions]));
}

// The partners one login looks after (not archived): the ones it has a care team seat on (Care teams on), plus,
// for a missions team member, every partner with no team of its own. Each row says how: { partnerId, via,
// seat } where via is "team" or "missionsTeam" and seat is the care team membership (lead flag, since when).
async function partnersOwnedBy(userId) {
  const out = [];
  const teamsOn = await careTeamsOn();
  if (teamsOn) {
    const seats = await prisma.careTeamMember.findMany({
      where: { userId, partner: { archived: false } },
      select: { partnerId: true, isLead: true, createdAt: true },
    });
    seats.forEach((s) => out.push({ partnerId: s.partnerId, via: "team", seat: s }));
  }
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { onMissionsTeam: true, active: true, role: true },
  });
  if (me?.onMissionsTeam && me.active && me.role !== "guest") {
    const partners = await prisma.partner.findMany({
      where: {
        archived: false,
        ...(teamsOn ? { careTeam: { none: { user: ACTIVE_CARER } } } : {}),
      },
      select: { id: true, createdAt: true },
    });
    partners.forEach((p) =>
      out.push({ partnerId: p.id, via: "missionsTeam", seat: { isLead: false, createdAt: p.createdAt } })
    );
  }
  return out;
}

module.exports = { careTeamsOn, missionsTeamIds, careTeamsByPartner, ownersByPartner, partnersOwnedBy };
