const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireRole("admin")); // user management is admin-only

// Trip Leader (role: "tripLeader") is a scoped guest account, not one of
// the 3 full roles -- scopedTripId is required for it and meaningless
// (cleared, below) for every other role. expiresAt is optional even for
// a tripLeader -- plenty of trips run long enough that a hard cutoff
// isn't always wanted.
const ROLE_ENUM = z.enum(["admin", "editor", "viewer", "tripLeader"]);

function clearScopeUnlessTripLeader(data) {
  if (data.role !== undefined && data.role !== "tripLeader") {
    data.scopedTripId = null;
    data.expiresAt = null;
  }
  return data;
}

async function tripLeaderScopeValid(data) {
  if (data.role !== "tripLeader") return true;
  if (!data.scopedTripId) return false;
  const trip = await prisma.trip.findUnique({ where: { id: data.scopedTripId }, select: { id: true } });
  return !!trip;
}
const TRIP_LEADER_SCOPE_ISSUE = {
  message: "A Trip Leader account needs a trip to scope it to",
  path: ["scopedTripId"],
};

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  role: ROLE_ENUM.default("editor"),
  scopedTripId: z.string().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  // Every account is local now. The column stays (see the User model in
  // schema.prisma) because auth.js still refuses to password-authenticate
  // anything that isn't "local" -- cheap insurance against a passwordless
  // row ever being created by some future path.
  authProvider: z.literal("local").default("local"),
  password: z.string().min(8),
});

const updateUserSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  role: ROLE_ENUM.optional(),
  scopedTripId: z.string().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(), // admin resetting someone's password
  mfaSetupRequired: z.boolean().optional(), // forces MFA enrollment at next login
});

function sanitize(user) {
  const { passwordHash, mfaSecret, ...rest } = user;
  return rest;
}

// Refuses to demote/deactivate/delete the last active admin, so the team
// can't accidentally lock everyone out of the admin panel.
async function wouldRemoveLastAdmin(targetId, becomingNonAdminOrInactive) {
  if (!becomingNonAdminOrInactive) return false;
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.role !== "admin") return false;
  const otherActiveAdmins = await prisma.user.count({
    where: { role: "admin", active: true, id: { not: targetId } },
  });
  return otherActiveAdmins === 0;
}

// scopedTrip included so AdminUsers.jsx can show which trip a Trip
// Leader account is actually scoped to, not just a bare id -- null for
// every other role.
const scopedTripInclude = {
  scopedTrip: { select: { id: true, name: true, type: true, partner: { select: { displayName: true } } } },
};

router.get("/", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { email: "asc" }, include: scopedTripInclude });
    res.json(users.map(sanitize));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(sanitize(user));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = clearScopeUnlessTripLeader(createUserSchema.parse(req.body));
    if (!(await tripLeaderScopeValid(data))) {
      return res.status(400).json({ error: TRIP_LEADER_SCOPE_ISSUE.message });
    }
    // Always present: the schema requires it now that every account is local.
    const passwordHash = await bcrypt.hash(data.password, 12);

    const created = await prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        scopedTripId: data.scopedTripId,
        expiresAt: data.expiresAt,
        authProvider: data.authProvider,
        passwordHash,
      },
    });
    res.status(201).json(sanitize(created));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { password, ...data } = updateUserSchema.parse(req.body);

    const becomingNonAdminOrInactive =
      (data.role !== undefined && data.role !== "admin") || data.active === false;
    if (await wouldRemoveLastAdmin(req.params.id, becomingNonAdminOrInactive)) {
      return res.status(400).json({ error: "Cannot remove the last active admin" });
    }

    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    // Effective role/scope once this update applies -- this call's own
    // value if it's touching that field, otherwise whatever the user
    // already has. A role change away from "tripLeader" always clears
    // the scope (never left dangling from a prior role), even if this
    // call didn't itself mention scopedTripId/expiresAt.
    const effectiveRole = data.role !== undefined ? data.role : existing.role;
    const effectiveScopedTripId =
      data.scopedTripId !== undefined ? data.scopedTripId : existing.scopedTripId;
    if (effectiveRole === "tripLeader" && !effectiveScopedTripId) {
      return res.status(400).json({ error: TRIP_LEADER_SCOPE_ISSUE.message });
    }
    if (effectiveRole === "tripLeader") {
      const trip = await prisma.trip.findUnique({
        where: { id: effectiveScopedTripId },
        select: { id: true },
      });
      if (!trip) return res.status(400).json({ error: TRIP_LEADER_SCOPE_ISSUE.message });
    }

    const updateData = { ...data };
    if (effectiveRole !== "tripLeader") {
      updateData.scopedTripId = null;
      updateData.expiresAt = null;
    }
    if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({ where: { id: req.params.id }, data: updateData });
    res.json(sanitize(updated));
  } catch (err) {
    next(err);
  }
});

// Recovery path for a user who lost their authenticator device — clears
// MFA so they can log in with just their password and re-enroll from
// Account Settings. Admins can't see or set the secret itself, only force
// it off.
//
// Refuses to target the caller's own account, same guard as DELETE /:id
// below. auth.js's self-service /mfa/disable deliberately requires
// re-entering the current password first, specifically so a hijacked
// browser tab can't silently strip MFA off the account -- this route had
// no such check, so an admin (or a hijacked admin session) could reach
// the same end state through this one instead, with no password at all.
// This route's own purpose is recovering someone *else's* account, so
// disallowing self-target doesn't remove any real capability; it just
// closes the path that bypassed the protection.
router.post("/:id/mfa/reset", async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Use Account Settings to disable your own MFA" });
    }
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    res.json(sanitize(updated));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }
    if (await wouldRemoveLastAdmin(req.params.id, true)) {
      return res.status(400).json({ error: "Cannot delete the last active admin" });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
