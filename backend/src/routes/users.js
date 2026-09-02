const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireRole("admin")); // user management is admin-only

const createUserSchema = z
  .object({
    email: z.string().email(),
    name: z.string().optional().nullable(),
    role: z.enum(["admin", "editor", "viewer"]).default("editor"),
    // "sso" here is just a placeholder for pre-provisioning a user before
    // their first SSO login — it gets overwritten with the actual
    // provider's type (see routes/sso.js) once they actually sign in.
    authProvider: z.enum(["local", "sso"]).default("local"),
    password: z.string().min(8).optional(),
  })
  .refine((data) => data.authProvider !== "local" || !!data.password, {
    message: "Password is required for local accounts",
    path: ["password"],
  });

const updateUserSchema = z.object({
  name: z.string().optional().nullable(),
  role: z.enum(["admin", "editor", "viewer"]).optional(),
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

router.get("/", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
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
    const data = createUserSchema.parse(req.body);
    const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : null;

    const created = await prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        name: data.name,
        role: data.role,
        authProvider: data.authProvider,
        passwordHash,
      },
    });
    res.status(201).json(sanitize(created));
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    if (err.code === "P2002") return res.status(409).json({ error: "Email already in use" });
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

    const updateData = { ...data };
    if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({ where: { id: req.params.id }, data: updateData });
    res.json(sanitize(updated));
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// Recovery path for a user who lost their authenticator device — clears
// MFA so they can log in with just their password and re-enroll from
// Account Settings. Admins can't see or set the secret itself, only force
// it off.
router.post("/:id/mfa/reset", async (req, res, next) => {
  try {
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    res.json(sanitize(updated));
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
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
