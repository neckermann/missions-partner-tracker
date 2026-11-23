const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { sendWelcomeEmail } = require("../utils/welcomeEmails");
const { isFeatureEnabled } = require("../utils/features");

// Narrow-select, same discipline every other route's own getSettings()
// follows -- this route only ever needs to know if outbound email is on.
async function getSettings() {
  return prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
}

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
  // Optional: the preferred path is no admin-set password at all -- the
  // welcome email's one-time link lets the person choose their own (see
  // utils/passwordSetup.js). An admin-typed password is only used when
  // sendWelcomeEmail is false.
  password: z.string().min(8).optional(),
  // Default on: email the new person a secure link to set their own
  // password. Off = no email is sent; the account stays pending (it can't
  // sign in) until a password is set or a link is sent from the user list.
  sendWelcomeEmail: z.boolean().default(true),
  // Force two-factor enrollment the first time they sign in.
  requireMfa: z.boolean().default(false),
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

// passwordSetupPending: the account exists but has no password yet (a
// welcome link hasn't been redeemed, or was never sent), so it can't sign in.
function sanitize(user) {
  const { passwordHash, mfaSecret, ...rest } = user;
  return { ...rest, passwordSetupPending: !passwordHash };
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
    const { sendWelcomeEmail: sendWelcome, requireMfa, password, ...rest } = createUserSchema.parse(req.body);
    const data = clearScopeUnlessTripLeader(rest);
    if (!(await tripLeaderScopeValid(data))) {
      return res.status(400).json({ error: TRIP_LEADER_SCOPE_ISSUE.message });
    }
    // With a welcome email the person chooses their own password, so the
    // account starts with none (it can't sign in until they do). An
    // explicitly-given password always wins over that, though, regardless
    // of sendWelcomeEmail -- a caller that bothers to supply one clearly
    // wants it used, and silently discarding it (sendWelcomeEmail defaults
    // to true, so every pre-existing caller that doesn't know about this
    // field would otherwise get a passwordless account with no error and
    // no indication why) is a real backward-compatibility break, not a
    // feature. Confirmed as a real bug, not a hypothetical: every e2e test
    // that creates a user via POST /api/users with a password and no
    // sendWelcomeEmail field (pre-existing helper, written before this
    // field existed) got a passwordless account and hung at sign-in.
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

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
        mfaSetupRequired: requireMfa,
      },
    });

    // A failed send (no APP_BASE_URL, provider error) must never lose the
    // account just created -- report it and let the admin resend from the
    // user list. Outbound email being disabled for this church entirely is
    // not a failure to report, though -- same as /:id/setup-link below, the
    // setup link itself needs nothing Postmark-shaped to exist, only its
    // automatic emailing does, so hand the admin the link directly instead
    // of pretending this can't be done without email configured.
    let welcomeEmail = { sent: false, skipped: true };
    if (sendWelcome && !password) {
      const settings = await getSettings();
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        try {
          await sendWelcomeEmail(created, { requireMfa });
          welcomeEmail = { sent: true };
        } catch (err) {
          welcomeEmail = { sent: false, error: err.message || "Couldn't send the welcome email" };
        }
      } else {
        const { issueSetupToken, buildSetupUrl } = require("../utils/passwordSetup");
        const { token } = await issueSetupToken(created);
        welcomeEmail = { sent: false, manualSetupUrl: buildSetupUrl(token) };
      }
    }
    res.status(201).json({ ...sanitize(created), welcomeEmail });
  } catch (err) {
    // The generic P2002 handler in middleware/errors.js says "That value is
    // already in use" -- technically correct, but an admin adding a user
    // reads it as a form-validation complaint, not as "this account already
    // exists, you don't need a new one." Worth the specific message here:
    // this is the one place in the app where the unique field being an
    // *account* (not a partner, a trip, etc.) actually changes what the
    // right next action is. email is User's only @unique field, so any
    // P2002 from this create() is necessarily this collision -- no need to
    // inspect err.meta.target, whose shape isn't reliable with this
    // project's Prisma driver adapter (confirmed: it came back empty here).
    if (err?.code === "P2002") {
      return res.status(409).json({
        error: "A user with this email already exists. To change their permissions, edit their existing account instead.",
      });
    }
    next(err);
  }
});

// Sends (or re-sends) the welcome/password-setup email to an account that
// has no password yet. Issuing a new link invalidates any earlier one.
// Refuses accounts that already have a password -- those use the normal
// sign-in or an admin password reset, not a setup link. Same
// email-off/manual-link handling as POST / above.
router.post("/:id/setup-link", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "Not found" });
    if (!user.active || user.authProvider !== "local") {
      return res.status(400).json({ error: "This account can't receive a setup link" });
    }
    if (user.passwordHash) {
      return res.status(400).json({ error: "This account already has a password" });
    }
    const settings = await getSettings();
    if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
      await sendWelcomeEmail(user, { requireMfa: user.mfaSetupRequired });
      res.json({ sent: true });
    } else {
      const { issueSetupToken, buildSetupUrl } = require("../utils/passwordSetup");
      const { token } = await issueSetupToken(user);
      res.json({ sent: false, manualSetupUrl: buildSetupUrl(token) });
    }
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
    const effectiveScopedTripId = data.scopedTripId !== undefined ? data.scopedTripId : existing.scopedTripId;
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
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 12);
      // An admin-set password supersedes any outstanding setup link.
      await prisma.passwordSetupToken.deleteMany({ where: { userId: req.params.id } });
    }

    const updated = await prisma.user.update({ where: { id: req.params.id }, data: updateData });
    res.json(sanitize(updated));
  } catch (err) {
    next(err);
  }
});

// Recovery path for a user who lost their authenticator device — clears
// MFA so they can log in with just their password and re-enroll from
// Account Settings. Admins can't see or set the secret itself, only force
// it off. (Doesn't apply to a tripLeader account: #329 Finding 2 made
// MFA enrollment/disable fully admin-managed for that role, with no
// self-service re-enroll -- an admin wanting MFA back on would need to
// require it again via PUT /:id and let them re-enroll at next login.)
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
