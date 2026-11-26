const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireAuth, requireRole } = require("../middleware/requireAuth");
const { recordAudit } = require("../utils/auditLog");

// The missions team: the group that looks after every partner with no care team of its own (see
// utils/ownership.js). Always available, whatever features are on: a church that never uses Care teams still
// needs somewhere to say who looks after its partners. The group's NAME is church wording, saved with the
// other settings (ChurchSettings.ownerGroupName).
const router = express.Router();
router.use(requireAuth);

const personLabel = (u) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
const view = (u) => ({ id: u.id, name: personLabel(u), email: u.email, role: u.role });
const select = { id: true, email: true, firstName: true, lastName: true, role: true, onMissionsTeam: true };

// Who is on it, and the logins that could be: active, never a guest.
router.get("/missions-team", requireRole("admin", "editor"), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { active: true, role: { not: "guest" } },
      select,
      orderBy: { email: "asc" },
    });
    res.json({
      members: users.filter((u) => u.onMissionsTeam).map(view),
      candidates: users.map(view),
    });
  } catch (err) {
    next(err);
  }
});

// Replaces the whole team with exactly these logins.
router.put("/missions-team", requireRole("admin"), async (req, res, next) => {
  try {
    const { userIds } = z.object({ userIds: z.array(z.string().min(1)).max(200) }).parse(req.body);
    const wanted = new Set(userIds);
    const eligible = await prisma.user.findMany({
      where: { id: { in: userIds }, active: true, role: { not: "guest" } },
      select: { id: true },
    });
    if (eligible.length !== wanted.size) {
      return res.status(400).json({ error: "The missions team can only hold active, non-guest logins" });
    }
    const before = await prisma.user.findMany({ where: { onMissionsTeam: true }, select });
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { onMissionsTeam: true, id: { notIn: userIds } },
        data: { onMissionsTeam: false },
      }),
      prisma.user.updateMany({ where: { id: { in: userIds } }, data: { onMissionsTeam: true } }),
    ]);
    const after = await prisma.user.findMany({ where: { onMissionsTeam: true }, select });
    const names = (list) => list.map(personLabel).sort();
    if (JSON.stringify(names(before)) !== JSON.stringify(names(after))) {
      await recordAudit(null, {
        action: "settings.updated",
        actor: req.user,
        entity: { type: "settings", label: "Missions team" },
        req,
        details: { missionsTeam: { from: names(before), to: names(after) } },
      });
    }
    res.json({ members: after.map(view) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
