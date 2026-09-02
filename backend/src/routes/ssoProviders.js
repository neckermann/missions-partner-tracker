const express = require("express");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { encryptField } = require("../utils/crypto");

const router = express.Router();
// Admin-only — SSO config is site-wide auth policy, same blast radius as
// user management, not per-record data.
router.use(requireRole("admin"));

const baseFields = {
  type: z.enum(["entra", "google", "okta", "oidc"]),
  enabled: z.boolean().optional(),
  displayName: z.string().min(1),
  issuerUrl: z.string().url(),
  clientId: z.string().min(1),
  allowedDomain: z.string().optional().nullable(),
};

const createSchema = z.object({ ...baseFields, clientSecret: z.string().min(1) });
// clientSecret omitted/blank on update keeps the existing value — same
// leave-blank-to-keep-current UX as a user's password reset field.
const updateSchema = z.object({ ...baseFields, clientSecret: z.string().min(1).optional() }).partial();

// Never echo the secret back, encrypted or not — same principle as
// passwordHash/mfaSecret in routes/users.js.
function sanitize(provider) {
  const { clientSecret, ...rest } = provider;
  return { ...rest, hasClientSecret: Boolean(clientSecret) };
}

router.get("/", async (req, res, next) => {
  try {
    const providers = await prisma.ssoProvider.findMany({ orderBy: { displayName: "asc" } });
    res.json(providers.map(sanitize));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const provider = await prisma.ssoProvider.findUnique({ where: { id: req.params.id } });
    if (!provider) return res.status(404).json({ error: "Not found" });
    res.json(sanitize(provider));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const created = await prisma.ssoProvider.create({
      data: { ...data, clientSecret: encryptField(data.clientSecret), updatedById: req.user.id },
    });
    res.status(201).json(sanitize(created));
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { clientSecret, ...rest } = updateSchema.parse(req.body);
    const data = { ...rest, updatedById: req.user.id };
    if (clientSecret) data.clientSecret = encryptField(clientSecret);

    const updated = await prisma.ssoProvider.update({ where: { id: req.params.id }, data });
    res.json(sanitize(updated));
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.errors });
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.ssoProvider.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

module.exports = router;
