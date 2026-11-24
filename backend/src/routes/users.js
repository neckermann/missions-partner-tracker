const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const prisma = require("../prismaClient");
const { requireRole } = require("../middleware/requireAuth");
const { sendWelcomeEmail } = require("../utils/welcomeEmails");
const { isFeatureEnabled } = require("../utils/features");
const { recordAudit } = require("../utils/auditLog");
const {
  GRANT_SELECT,
  summarizeGrants,
  guestInactiveReason,
  parseOverrideExpiry,
  isCareTeamEnabled,
  deactivateGuestIfNoGrants,
} = require("../utils/guestAccess");
const { passwordSchema } = require("../utils/password");
const { isTwoFactorRequired } = require("../utils/twoFactor");

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

// Guest (role: "guest") is a scoped login, not one of the 3 full roles
// (#356): it reaches only what its grants allow. Today that means TripAccess
// rows; #289 adds care team seats, at which point a guest may hold those
// instead of any trip. Until then a guest needs at least one trip.
const ROLE_ENUM = z.enum(["admin", "editor", "viewer", "guest"]);

// expiresAt on a grant is only ever an override of the derived "trip end
// date + 30 days" (see utils/guestAccess.js): a date or timestamp, or
// null/omitted to use the derived date.
const grantInput = z.object({
  tripId: z.string().min(1),
  expiresAt: z
    .string()
    .optional()
    .nullable()
    .refine((v) => v == null || !Number.isNaN(parseOverrideExpiry(v).getTime()), "Invalid date"),
});

const GUEST_NEEDS_ACCESS =
  "A guest account needs at least one trip, or a partner whose care team it joins, to give it access to";

async function allPartnersExist(partnerIds) {
  const unique = [...new Set(partnerIds)];
  const found = await prisma.partner.count({ where: { id: { in: unique } } });
  return found === unique.length;
}

// Plain-member seats on partners' care teams, for a login created or
// promoted with `careTeam`. Never touches an existing lead.
async function addCareSeats(db, user, inputs, ctx) {
  for (const { partnerId } of inputs) {
    const had = await db.careTeamMember.findUnique({
      where: { partnerId_userId: { partnerId, userId: user.id } },
      select: { id: true },
    });
    await db.careTeamMember.upsert({
      where: { partnerId_userId: { partnerId, userId: user.id } },
      update: {},
      create: { partnerId, userId: user.id, isLead: false },
    });
    if (!had && ctx) {
      const partner = await db.partner.findUnique({
        where: { id: partnerId },
        select: { displayName: true },
      });
      await recordAudit(db, {
        action: "care_team.updated",
        actor: ctx.actor,
        target: user,
        entity: { type: "partner", id: partnerId, label: partner?.displayName ?? null },
        req: ctx.req,
        details: { added: ["as a member"] },
      });
    }
  }
}

async function allTripsExist(tripIds) {
  const unique = [...new Set(tripIds)];
  const found = await prisma.trip.count({ where: { id: { in: unique } } });
  return found === unique.length;
}

const auditCtx = (req) => ({ actor: req.user, req });

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  role: ROLE_ENUM.default("editor"),
  // A guest needs at least one trip OR one care team seat; both are ignored
  // for the full roles (any login can join a care team later, from the
  // partner's page). Seats added here are plain members -- the lead is
  // chosen from the partner's own care team.
  tripAccess: z.array(grantInput).optional(),
  careTeam: z.array(z.object({ partnerId: z.string().min(1) })).optional(),
  // Every account is local now. The column stays (see the User model in
  // schema.prisma) because auth.js still refuses to password-authenticate
  // anything that isn't "local" -- cheap insurance against a passwordless
  // row ever being created by some future path.
  authProvider: z.literal("local").default("local"),
  // Optional: the preferred path is no admin-set password at all -- the
  // welcome email's one-time link lets the person choose their own (see
  // utils/passwordSetup.js). An admin-typed password is only used when
  // sendWelcomeEmail is false.
  password: passwordSchema.optional(),
  // Default on: email the new person a secure link to set their own
  // password. Off = no email is sent; the account stays pending (it can't
  // sign in) until a password is set or a link is sent from the user list.
  sendWelcomeEmail: z.boolean().default(true),
  // Force two-factor enrollment the first time this one person signs in. Separate from the
  // church-wide requirement (ChurchSettings.requireTwoFactor, #385), which applies to everyone
  // whatever this says.
  requireMfa: z.boolean().default(false),
});

const updateUserSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  role: ROLE_ENUM.optional(),
  // Only read when changing a non-guest into a guest (they need a first
  // grant); manage grants afterward via /:id/trip-access, and care team
  // seats from the partner's own page.
  tripAccess: z.array(grantInput).optional(),
  careTeam: z.array(z.object({ partnerId: z.string().min(1) })).optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(), // admin resetting someone's password
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

// Creates (or updates the override on) one TripAccess row per input. `db` is
// a transaction handle. No audit trail yet: recording who changed whose
// access is deferred to the admin audit/activity design in #341, which
// should cover these events (grant, extend/end, revoke, and the
// deactivation below) along with the rest of the app's sensitive actions.
// Records one trip-access event (#341). `ctx` is { actor, req } from the route;
// the row commits with the change when `db` is a transaction handle.
async function auditAccess(db, ctx, action, user, tripId, details) {
  if (!ctx) return;
  const trip = await db.trip.findUnique({ where: { id: tripId }, select: { id: true, name: true } });
  await recordAudit(db, {
    action,
    actor: ctx.actor,
    target: user,
    entity: { type: "trip", id: tripId, label: trip?.name ?? null },
    req: ctx.req,
    details,
  });
}

async function grantTripAccess(db, user, inputs, ctx) {
  for (const input of inputs) {
    const expiresAt = input.expiresAt == null ? null : parseOverrideExpiry(input.expiresAt);
    const before = await db.tripAccess.findUnique({
      where: { userId_tripId: { userId: user.id, tripId: input.tripId } },
    });
    await db.tripAccess.upsert({
      where: { userId_tripId: { userId: user.id, tripId: input.tripId } },
      update: { expiresAt },
      create: { userId: user.id, tripId: input.tripId, expiresAt },
    });
    await auditAccess(db, ctx, before ? "trip_access.update" : "trip_access.grant", user, input.tripId, {
      expiresAt: { from: before?.expiresAt ?? null, to: expiresAt },
    });
  }
}

// Removes trip grants. If that leaves a guest with no grant of any kind (no
// trip, no care team seat), deactivates the login (not deletes) so an admin
// can still find it under the Inactive filter, and ends any open session.
async function revokeTripAccess(db, user, tripIds, ctx, reason) {
  const existing = await db.tripAccess.findMany({
    where: { userId: user.id, tripId: { in: tripIds } },
    select: { tripId: true },
  });
  await db.tripAccess.deleteMany({ where: { userId: user.id, tripId: { in: tripIds } } });
  for (const { tripId } of existing) {
    await auditAccess(db, ctx, "trip_access.revoke", user, tripId, reason ? { reason } : undefined);
  }
  const deactivated = await deactivateGuestIfNoGrants(db, user);
  if (deactivated && ctx) {
    await recordAudit(db, {
      action: "guest.deactivate_no_access",
      actor: ctx.actor,
      target: user,
      req: ctx.req,
    });
  }
  return deactivated;
}

// Grants are included (with each trip's end date) so the Users list can show
// what a guest can reach, when it lapses, and whether the account is
// effectively inactive -- all without a query per user.
const userInclude = {
  tripAccess: { select: GRANT_SELECT, orderBy: { createdAt: "asc" } },
  careTeamSeats: {
    select: { id: true, isLead: true, partner: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  },
};

// `careEnabled`: seats only count (and are only shown) while the careTeam
// feature is on -- the data is kept when it's off, but it's hidden and
// ignored for access, so it must be ignored here too.
function withAccess(user, now = new Date(), careEnabled = false) {
  const { tripAccess, careTeamSeats, ...rest } = user;
  const grants = summarizeGrants(tripAccess || [], now);
  const seats = careEnabled ? careTeamSeats || [] : [];
  return {
    ...sanitize(rest),
    tripAccess: grants,
    careTeamSeats: seats,
    // null for a guest who can currently sign in, and for every other role.
    inactiveReason: guestInactiveReason(user, grants, seats.length),
  };
}

// ?inactive=true lists the accounts an admin may want to reach out to and
// clean up: guests that are deactivated, expired, or left with no grants.
router.get("/", async (req, res, next) => {
  try {
    const [users, careEnabled] = await Promise.all([
      prisma.user.findMany({ orderBy: { email: "asc" }, include: userInclude }),
      isCareTeamEnabled(),
    ]);
    const now = new Date();
    let rows = users.map((u) => withAccess(u, now, careEnabled));
    if (req.query.inactive === "true") rows = rows.filter((u) => u.inactiveReason);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Guests holding (or once holding) access to one trip -- for the trip
// page's access panel. Registered before "/:id" so "by-trip" isn't read
// as a user id.
router.get("/by-trip/:tripId", async (req, res, next) => {
  try {
    const rows = await prisma.tripAccess.findMany({
      where: { tripId: req.params.tripId },
      select: {
        ...GRANT_SELECT,
        user: { select: { id: true, email: true, firstName: true, lastName: true, active: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const now = new Date();
    const grants = summarizeGrants(rows, now);
    res.json(grants.map((g, i) => ({ ...g, user: rows[i].user })));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: userInclude });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(withAccess(user, new Date(), await isCareTeamEnabled()));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      sendWelcomeEmail: sendWelcome,
      requireMfa: requireMfaRequested,
      password,
      tripAccess: grantInputs = [],
      careTeam: careInputs = [],
      ...data
    } = createUserSchema.parse(req.body);
    const isGuest = data.role === "guest";
    // The admin's per-account choice; no role is special. Requiring it of everyone is the
    // church-wide setting (#385), which login and requireAuth read directly.
    const requireMfa = requireMfaRequested;
    // Seats need the feature on; otherwise they'd be created but ignored.
    const careEnabled = await isCareTeamEnabled();
    if (careInputs.length > 0 && !careEnabled) {
      return res.status(400).json({ error: "Care teams are turned off" });
    }
    if (careInputs.length > 0 && !(await allPartnersExist(careInputs.map((c) => c.partnerId)))) {
      return res.status(400).json({ error: "One or more of those partners couldn't be found" });
    }
    if (isGuest) {
      const tripsOk = grantInputs.length > 0 && (await allTripsExist(grantInputs.map((g) => g.tripId)));
      if (!tripsOk && careInputs.length === 0) {
        return res.status(400).json({ error: GUEST_NEEDS_ACCESS });
      }
      if (grantInputs.length > 0 && !tripsOk) {
        return res.status(400).json({ error: GUEST_NEEDS_ACCESS });
      }
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

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email.toLowerCase().trim(),
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
          authProvider: data.authProvider,
          passwordHash,
          mfaSetupRequired: requireMfa,
        },
      });
      await recordAudit(tx, {
        action: "user.created",
        actor: req.user,
        target: user,
        req,
        details: { role: user.role },
      });
      if (isGuest) await grantTripAccess(tx, user, grantInputs, auditCtx(req));
      // Any role can hold a seat (a full role gets the marker and view, a
      // guest gets reach), so this isn't guest-only.
      await addCareSeats(tx, user, careInputs, auditCtx(req));
      return user;
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
          await sendWelcomeEmail(created, { requireMfa: requireMfa || (await isTwoFactorRequired()) });
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
    const withGrants = await prisma.user.findUnique({ where: { id: created.id }, include: userInclude });
    res.status(201).json({ ...withAccess(withGrants, new Date(), careEnabled), welcomeEmail });
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
        error:
          "A user with this email already exists. To change their permissions, edit their existing account instead.",
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
      await sendWelcomeEmail(user, { requireMfa: user.mfaSetupRequired || (await isTwoFactorRequired()) });
      await recordAudit(null, {
        action: "user.setup_link_sent",
        actor: req.user,
        target: user,
        req,
        details: { delivery: "email" },
      });
      res.json({ sent: true });
    } else {
      const { issueSetupToken, buildSetupUrl } = require("../utils/passwordSetup");
      const { token } = await issueSetupToken(user);
      await recordAudit(null, {
        action: "user.setup_link_sent",
        actor: req.user,
        target: user,
        req,
        details: { delivery: "link shown to the admin" },
      });
      res.json({ sent: false, manualSetupUrl: buildSetupUrl(token) });
    }
  } catch (err) {
    next(err);
  }
});

// --- Trip access grants (#356) ---------------------------------------
// Admin-only like the rest of this router. Removing the last grant
// deactivates the guest (see revokeTripAccess); extending or ending a
// grant just moves its expiresAt override, which requireAuth honours on
// the guest's very next request.

const grantUpdateSchema = z.object({
  // A date/timestamp = extend or end early; null = back to the derived
  // "trip end date + 30 days".
  expiresAt: z
    .string()
    .nullable()
    .refine((v) => v === null || !Number.isNaN(parseOverrideExpiry(v).getTime()), "Invalid date"),
});

router.get("/:id/trip-access", async (req, res, next) => {
  try {
    const rows = await prisma.tripAccess.findMany({
      where: { userId: req.params.id },
      select: GRANT_SELECT,
      orderBy: { createdAt: "asc" },
    });
    res.json(summarizeGrants(rows));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/trip-access", async (req, res, next) => {
  try {
    const input = grantInput.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "Not found" });
    if (user.role !== "guest") {
      return res
        .status(400)
        .json({ error: "Only guest accounts take trip access -- full roles already see every trip" });
    }
    if (!(await allTripsExist([input.tripId]))) {
      return res.status(400).json({ error: "That trip doesn't exist" });
    }
    await prisma.$transaction((tx) => grantTripAccess(tx, user, [input], auditCtx(req)));
    const rows = await prisma.tripAccess.findMany({
      where: { userId: user.id },
      select: GRANT_SELECT,
      orderBy: { createdAt: "asc" },
    });
    // `active` is echoed so the UI can say so when an admin grants access
    // to a login that was deactivated for having none -- reactivating it is
    // a deliberate separate step, not a side effect of granting.
    res.status(201).json({ accountActive: user.active, tripAccess: summarizeGrants(rows) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id/trip-access/:tripId", async (req, res, next) => {
  try {
    const { expiresAt } = grantUpdateSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "Not found" });
    const existing = await prisma.tripAccess.findUnique({
      where: { userId_tripId: { userId: user.id, tripId: req.params.tripId } },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    const value = expiresAt === null ? null : parseOverrideExpiry(expiresAt);
    await prisma.$transaction(async (tx) => {
      await tx.tripAccess.update({ where: { id: existing.id }, data: { expiresAt: value } });
      await auditAccess(tx, auditCtx(req), "trip_access.update", user, req.params.tripId, {
        expiresAt: { from: existing.expiresAt, to: value },
      });
    });
    const rows = await prisma.tripAccess.findMany({
      where: { userId: user.id },
      select: GRANT_SELECT,
      orderBy: { createdAt: "asc" },
    });
    res.json(summarizeGrants(rows));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/trip-access/:tripId", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "Not found" });
    const deactivated = await prisma.$transaction((tx) =>
      revokeTripAccess(tx, user, [req.params.tripId], auditCtx(req))
    );
    res.json({ deactivated });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { password, tripAccess, careTeam: careInputs = [], ...data } = updateUserSchema.parse(req.body);

    const becomingNonAdminOrInactive =
      (data.role !== undefined && data.role !== "admin") || data.active === false;
    if (await wouldRemoveLastAdmin(req.params.id, becomingNonAdminOrInactive)) {
      return res.status(400).json({ error: "Cannot remove the last active admin" });
    }

    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const effectiveRole = data.role !== undefined ? data.role : existing.role;
    const becomingGuest = effectiveRole === "guest" && existing.role !== "guest";
    const leavingGuest = existing.role === "guest" && effectiveRole !== "guest";
    const grantInputs = tripAccess || [];
    const careEnabled = await isCareTeamEnabled();
    if (careInputs.length > 0 && !careEnabled) {
      return res.status(400).json({ error: "Care teams are turned off" });
    }
    if (careInputs.length > 0 && !(await allPartnersExist(careInputs.map((c) => c.partnerId)))) {
      return res.status(400).json({ error: "One or more of those partners couldn't be found" });
    }
    if (becomingGuest) {
      // Same rule as create: a guest with no grant can do nothing. They may
      // already hold care team seats from before they were made a guest.
      const existingSeats = await prisma.careTeamMember.count({ where: { userId: existing.id } });
      const tripsOk = grantInputs.length > 0 && (await allTripsExist(grantInputs.map((g) => g.tripId)));
      if (
        (!tripsOk && careInputs.length === 0 && existingSeats === 0) ||
        (grantInputs.length > 0 && !tripsOk)
      ) {
        return res.status(400).json({ error: GUEST_NEEDS_ACCESS });
      }
    }

    const updateData = { ...data };
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 12);
      // An admin-set password supersedes any outstanding setup link.
      await prisma.passwordSetupToken.deleteMany({ where: { userId: req.params.id } });
    }
    // #327 Finding 7: an admin-set password reset or a role change should
    // end every session this account already has open -- this is an admin
    // acting on *another* account here, not re-issuing a cookie for
    // themselves, so there's no "keep this tab working" concern the way
    // auth.js's self-service routes have.
    if (password || (data.role !== undefined && data.role !== existing.role)) {
      updateData.sessionVersion = { increment: 1 };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: req.params.id }, data: updateData });
      const changes = {};
      for (const key of ["email", "firstName", "lastName", "role", "active", "authProvider"]) {
        if (data[key] !== undefined && data[key] !== existing[key]) {
          changes[key] = { from: existing[key], to: data[key] };
        }
      }
      if (password) changes.password = "reset by an admin";
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          action: "user.updated",
          actor: req.user,
          target: user,
          req,
          details: changes,
        });
      }
      if (becomingGuest) await grantTripAccess(tx, user, grantInputs, auditCtx(req));
      await addCareSeats(tx, user, careInputs, auditCtx(req));
      if (leavingGuest) {
        // Grants mean nothing off the guest role -- clear them so they can't
        // silently revive if this account is ever made a guest again.
        const rows = await tx.tripAccess.findMany({ where: { userId: user.id }, select: { tripId: true } });
        // `user` already has its new, non-guest role, so revokeTripAccess
        // won't treat the now-empty grant list as an orphaned guest.
        await revokeTripAccess(
          tx,
          user,
          rows.map((r) => r.tripId),
          auditCtx(req),
          "no longer a guest"
        );
      }
      return user;
    });
    const fresh = await prisma.user.findUnique({ where: { id: updated.id }, include: userInclude });
    res.json(withAccess(fresh, new Date(), careEnabled));
  } catch (err) {
    next(err);
  }
});

// Recovery path for a user who lost their authenticator device — clears
// MFA so they can log in with just their password and re-enroll from
// Account Settings. Admins can't see or set the secret itself, only force
// it off. (While the church requires two-factor (#385) nobody can switch it off
// themselves, so this reset is how a lost authenticator is cleared: they sign in with
// their password and are taken straight through enrolment again.)
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
    // #327 Finding 7: same reasoning as the password-reset bump above --
    // this account's existing sessions shouldn't survive an admin forcing
    // MFA off.
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!target) return res.status(404).json({ error: "Not found" });
    // With the church-wide requirement on, they re-enrol at next sign-in because login sends
    // every unenrolled account to enrolment; nothing per-account needs setting here.
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { mfaEnabled: false, mfaSecret: null, sessionVersion: { increment: 1 } },
    });
    await recordAudit(null, { action: "user.mfa_reset", actor: req.user, target: updated, req });
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

    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: req.params.id } });
      await tx.user.delete({ where: { id: req.params.id } });
      await recordAudit(tx, {
        action: "user.deleted",
        actor: req.user,
        target,
        req,
        details: target ? { role: target.role } : undefined,
      });
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
