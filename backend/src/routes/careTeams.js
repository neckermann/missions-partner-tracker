const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { requireFeature } = require("../middleware/requireFeature");
const { canReadPartner, deactivateGuestIfNoGrants } = require("../utils/guestAccess");
const { recordAudit } = require("../utils/auditLog");

const personLabel = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : null);

// #289: a partner's care team -- one lead plus any number of members, all of
// them logins. Gated by the `careTeam` feature (404 when off, data kept).
//
// Reading is open to every login that can read the partner (a guest only for
// partners they hold a grant for); setting the team is admin/editor, like
// every other write on a partner -- "assignments" are staff's call, and a
// care team member gains no extra visibility from being on one (there is one
// partner page for every role; roles gate what you can change, not what you
// can see).
const router = express.Router();
router.use(requireAuth);
router.use(requireFeature("careTeam"));

// A guest only sees teammates' names, never their email addresses: they
// can't see the Users list, and a teammate's address isn't theirs to take.
function shapeMember(m, viewerRole) {
  const { user } = m;
  return {
    userId: user.id,
    isLead: m.isLead,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    ...(viewerRole === "guest" ? {} : { email: user.email }),
  };
}

const memberSelect = {
  isLead: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } },
};

async function loadTeam(partnerId, viewerRole) {
  const rows = await prisma.careTeamMember.findMany({
    where: { partnerId },
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });
  const members = rows.map((m) => shapeMember(m, viewerRole));
  return { lead: members.find((m) => m.isLead) || null, members: members.filter((m) => !m.isLead) };
}

// The logins a team can be made from -- active accounts only. Registered
// before "/:partnerId" so "candidates" isn't read as a partner id.
router.get("/candidates", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
      orderBy: { email: "asc" },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// #291: the church's default lead -- who key-date reminders go to for a partner
// with no care team. Read by admin/editor (they manage teams); set by admin.
// Lives here rather than in the generic settings route so it only exists while
// care teams do. Registered before "/:partnerId" so it isn't read as an id.
const defaultLeadView = (u) =>
  u ? { userId: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email } : null;
const defaultLeadSelect = { select: { id: true, email: true, firstName: true, lastName: true } };

router.get("/default-lead", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { defaultCareLead: defaultLeadSelect },
    });
    res.json({ defaultLead: defaultLeadView(settings?.defaultCareLead) });
  } catch (err) {
    next(err);
  }
});

router.put("/default-lead", requireRole("admin"), async (req, res, next) => {
  try {
    const { userId } = z.object({ userId: z.string().min(1).nullable() }).parse(req.body);
    if (userId) {
      const user = await prisma.user.findFirst({ where: { id: userId, active: true }, select: { id: true } });
      if (!user) return res.status(400).json({ error: "The default lead needs an active login" });
    }
    const previous = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { defaultCareLead: defaultLeadSelect },
    });
    const settings = await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { defaultCareLeadUserId: userId },
      create: { id: "singleton", defaultCareLeadUserId: userId },
      select: { defaultCareLead: defaultLeadSelect },
    });
    if ((previous?.defaultCareLead?.id ?? null) !== (settings.defaultCareLead?.id ?? null)) {
      await recordAudit(null, {
        action: "settings.updated",
        actor: req.user,
        entity: { type: "settings", label: "Default care team lead" },
        req,
        details: {
          defaultCareLead: {
            from: personLabel(previous?.defaultCareLead),
            to: personLabel(settings.defaultCareLead),
          },
        },
      });
    }
    res.json({ defaultLead: defaultLeadView(settings.defaultCareLead) });
  } catch (err) {
    next(err);
  }
});

router.get("/:partnerId", async (req, res, next) => {
  try {
    if (!canReadPartner(req.user, req.params.partnerId)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const partner = await prisma.partner.findUnique({
      where: { id: req.params.partnerId },
      select: { id: true },
    });
    if (!partner) return res.status(404).json({ error: "Not found" });
    res.json(await loadTeam(partner.id, req.user.role));
  } catch (err) {
    next(err);
  }
});

const setTeamSchema = z.object({
  leadUserId: z.string().min(1).nullable(),
  memberUserIds: z.array(z.string().min(1)),
});

// Replaces the whole team in one go -- what the assignment wizards send --
// rather than patching rows, so the one-lead rule is checked against the
// final set. A person is on a team once: naming the lead among the members
// too is just the lead.
router.put("/:partnerId", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const { leadUserId, memberUserIds } = setTeamSchema.parse(req.body);
    const partner = await prisma.partner.findUnique({
      where: { id: req.params.partnerId },
      select: { id: true, displayName: true },
    });
    if (!partner) return res.status(404).json({ error: "Not found" });

    const members = [...new Set(memberUserIds)].filter((id) => id !== leadUserId);
    const wanted = [...(leadUserId ? [leadUserId] : []), ...members];
    const users = await prisma.user.findMany({
      where: { id: { in: wanted }, active: true },
      select: { id: true },
    });
    if (users.length !== wanted.length) {
      return res.status(400).json({ error: "Everyone on a care team needs an active login" });
    }

    await prisma.$transaction(async (tx) => {
      const before = await tx.careTeamMember.findMany({
        where: { partnerId: partner.id },
        select: { userId: true, isLead: true },
      });
      const wantedSet = new Set(wanted);
      const removed = before.filter((b) => !wantedSet.has(b.userId)).map((b) => b.userId);
      await tx.careTeamMember.deleteMany({ where: { partnerId: partner.id, userId: { in: removed } } });
      // Clear the lead flag first so moving it between two people never
      // briefly has two leads (the partial unique index would refuse that).
      await tx.careTeamMember.updateMany({ where: { partnerId: partner.id }, data: { isLead: false } });
      for (const userId of wanted) {
        await tx.careTeamMember.upsert({
          where: { partnerId_userId: { partnerId: partner.id, userId } },
          update: { isLead: userId === leadUserId },
          create: { partnerId: partner.id, userId, isLead: userId === leadUserId },
        });
      }
      // A guest whose only way in was this seat has nothing left: deactivate
      // (never delete), same as removing a guest's last trip.
      for (const userId of removed) {
        const u = await tx.user.findUnique({ where: { id: userId } });
        if (u) await deactivateGuestIfNoGrants(tx, u);
      }

      // One entry for the whole edit: who joined, who left, and any lead change.
      const beforeIds = new Set(before.map((b) => b.userId));
      const added = wanted.filter((id) => !beforeIds.has(id));
      const leadBefore = before.find((b) => b.isLead)?.userId ?? null;
      const leadAfter = leadUserId ?? null;
      if (added.length || removed.length || leadBefore !== leadAfter) {
        const people = await tx.user.findMany({
          where: { id: { in: [...new Set([...added, ...removed, leadBefore, leadAfter].filter(Boolean))] } },
          select: { id: true, email: true, firstName: true, lastName: true },
        });
        const label = (id) => personLabel(people.find((p) => p.id === id)) ?? null;
        await recordAudit(tx, {
          action: "care_team.updated",
          actor: req.user,
          entity: { type: "partner", id: partner.id, label: partner.displayName },
          req,
          details: {
            ...(added.length ? { added: added.map(label) } : {}),
            ...(removed.length ? { removed: removed.map(label) } : {}),
            ...(leadBefore !== leadAfter ? { lead: { from: label(leadBefore), to: label(leadAfter) } } : {}),
          },
        });
      }
    });
    res.json(await loadTeam(partner.id, req.user.role));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
