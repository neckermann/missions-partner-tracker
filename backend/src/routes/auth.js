const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { generateSecret, generateURI, verify: verifyOtp } = require("otplib");
const QRCode = require("qrcode");
const prisma = require("../prismaClient");
const { requireAuth, requireAuthOrMfaSetup } = require("../middleware/requireAuth");
const { setSessionCookie, clearSessionCookie } = require("../utils/jwt");
const { encryptField, decryptField } = require("../utils/crypto");
const { appBaseUrl } = require("../utils/dispatchBlurbs");
const { escapeHtml } = require("../utils/emailDispatchShell");
const { findValidSetupToken, hashToken } = require("../utils/passwordSetup");
const { sendWelcomeEmail } = require("../utils/welcomeEmails");
const { isFeatureEnabled } = require("../utils/features");
const { DEFAULT_TRIP_REQUIREMENT_TEMPLATE } = require("../utils/defaultTripRequirementTemplate");
const { listTripGrants, isCareTeamEnabled } = require("../utils/guestAccess");
const { passwordSchema } = require("../utils/password");
const { recordAuditSafe } = require("../utils/auditLog");
const { isTwoFactorRequired } = require("../utils/twoFactor");
const { replaceRequirementItems } = require("../utils/tripTemplates");
const {
  isPasswordlessOn,
  isEmailReady,
  redeemSignInLink,
  sendSignInLinkEmail,
} = require("../utils/passwordless");

const router = express.Router();
const MFA_PENDING_TTL = "5m";
const MFA_SETUP_TTL = "20m";
// Shown in the user's authenticator app (Google Authenticator, Authy, etc.)
// next to their account when they scan the MFA setup QR code.
// A real bcrypt hash of a value nobody can supply, used only to burn the
// same CPU time a genuine comparison would. Generated at startup rather
// than hardcoded so it never looks like a credential.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-such-account-placeholder", 12);

const MFA_ISSUER = process.env.MFA_ISSUER || "Missions Partner Tracker Admin";

function signMfaPendingToken(user) {
  return jwt.sign({ id: user.id, mfaPending: true }, process.env.SESSION_SECRET, {
    expiresIn: MFA_PENDING_TTL,
  });
}

// Issued when an admin has required MFA on this account but the user
// hasn't enrolled yet — long enough to install an authenticator app and
// scan the QR code, but still not a real session.
function signMfaSetupToken(user) {
  return jwt.sign({ id: user.id, mfaSetup: true }, process.env.SESSION_SECRET, {
    expiresIn: MFA_SETUP_TTL,
  });
}

// Shared by the non-MFA login path and the post-MFA-verify path so both end
// up with an identical response shape and both record the login timestamp
// only once a session is actually granted. Sets the session cookie
// directly on `res` — the token itself never appears in the JSON body, so
// there's nothing for frontend JS to read or store.
async function completeLogin(res, user, req) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAuditSafe(null, { action: "auth.login_success", actor: user, req });
  setSessionCookie(res, user);
  return { user: await sanitizeUser(user) };
}

// What happens once a first factor (a correct password, or a spent emailed link) has proved who is
// signing in: a second factor to check, enrolment to finish, or the session itself.
async function afterFirstFactor(res, user, req) {
  if (user.mfaEnabled) {
    const passkeyCount = await prisma.userPasskey.count({ where: { userId: user.id } });
    return {
      mfaRequired: true,
      pendingToken: signMfaPendingToken(user),
      methods: { authenticatorApp: Boolean(user.mfaSecret), passkey: passkeyCount > 0 },
    };
  }
  // Not enrolled: sent to enrolment, with no session until they finish, when the church
  // requires two-factor of everyone (#385, which passwordless sign-in implies) or an admin
  // required it of this one account.
  if (user.mfaSetupRequired || (await isTwoFactorRequired())) {
    return { mfaSetupRequired: true, setupToken: signMfaSetupToken(user) };
  }
  return completeLogin(res, user, req);
}

// --- First-run setup ---
// Replaces the old "run node prisma/createAdmin.js from a shell with
// DATABASE_URL set" step with something doable entirely in the browser —
// the point of a one-click deploy is defeated if creating the very
// first login still needs local Node/database access. Both routes are
// public (no session exists yet to require), but self-disable the
// moment a real account exists.

// GET /api/auth/setup-status — the frontend uses this to route a fresh
// deploy straight to account creation instead of a login form nobody
// can use yet (see Login.jsx).
router.get("/setup-status", async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    // `passwordless` (#386): the sign-in page offers a passkey and an emailed link, not a password.
    res.json({ needed: count === 0, passwordless: await isPasswordlessOn() });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/setup — only ever succeeds once. Re-checks the count
// inside the handler (not just trusting an earlier GET) so this can
// never create a second admin once one exists — the same effect as
// requiring auth, without needing a session that doesn't exist yet.
router.post("/setup", async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return res.status(409).json({ error: "Setup has already been completed for this instance." });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) {
      return res.status(400).json({ error: parsedPassword.error.issues[0].message });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        role: "admin",
        authProvider: "local",
      },
    });

    // The only moment a genuinely fresh (non-demo) install can hook a
    // real first-run default into -- ChurchSettings otherwise only ever
    // gets created lazily, via upsert, the first time an admin saves some
    // settings page, which would leave tripRequirementTemplate at its
    // column default (null) rather than this real starting point. Upsert,
    // not create, since this route only guarantees zero prior Users, not
    // zero prior ChurchSettings -- never overwrites an existing row's
    // template if one somehow already exists.
    //
    // A fresh install also starts with the church-wide two-factor requirement ON (#385): secure
    // by default, and the first admin is the one person who can then decide to turn it off.
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: { requireTwoFactor: true },
      create: { id: "singleton", requireTwoFactor: true },
    });
    // #394: the starting requirement checklist is real rows; only when none exist yet.
    if ((await prisma.requirementTemplateItem.count({ where: { scope: "template" } })) === 0) {
      await replaceRequirementItems(prisma, "template", DEFAULT_TRIP_REQUIREMENT_TEMPLATE);
    }

    // No session is handed out: with the requirement on, an account that hasn't enrolled can't
    // use one. The first admin signs in with the password they just chose and is taken straight
    // through enrolment (POST /login).
    res.status(201).json({ ok: true, mfaSetupRequired: true });
  } catch (err) {
    next(err);
  }
});

// --- Local (username/password) ---
router.post("/login", async (req, res, next) => {
  try {
    // #386 Layer 2: with passwordless on, nobody signs in with a password -- a passkey, or an
    // emailed link for someone who hasn't added one yet. Church-wide, so it reveals nothing.
    if (await isPasswordlessOn()) {
      return res.status(403).json({
        error: "This church signs in with a passkey or an emailed link, not a password",
        passwordless: true,
      });
    }
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Hash against a dummy when there's no usable account, so a miss costs
    // the same ~100ms as a wrong password. Returning early instead would
    // make "this email has an account" measurable from the response time,
    // which is how you enumerate a church's admin addresses even though
    // every reply says the same thing.
    const usable = Boolean(user && user.active && user.authProvider === "local" && user.passwordHash);
    const match = await bcrypt.compare(password, usable ? user.passwordHash : DUMMY_PASSWORD_HASH);
    if (!usable || !match) {
      // The reason is for the admin reading the audit log; the caller still
      // gets the one generic answer.
      const reason = !user
        ? "unknown_email"
        : !user.active
          ? "inactive"
          : user.authProvider !== "local" || !user.passwordHash
            ? "not_a_password_account"
            : "wrong_password";
      await recordAuditSafe(null, {
        action: "auth.login_failed",
        target: user || { email: email.toLowerCase().trim() },
        req,
        details: { reason },
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json(await afterFirstFactor(res, user, req));
  } catch (err) {
    next(err);
  }
});

// --- Passwordless sign-in (#386 Layer 2) ---

// "Email me a sign-in link." The same reply for every address, and the email goes out after
// responding, so neither the message nor the response time reveals whether an account exists.
// Only an account with no passkey gets one: someone who has a passkey signs in with it, and one
// who lost it asks an admin (Reset MFA), so an inbox alone never replaces a passkey.
router.post("/passwordless/email-link", async (req, res) => {
  if (!(await isPasswordlessOn().catch(() => false))) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({ ok: true, message: "If that email has an account, a sign-in link is on its way." });
  try {
    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    if (!email || !(await isEmailReady())) return;
    const user = await prisma.user.findUnique({
      where: { email },
      include: { _count: { select: { passkeys: true } } },
    });
    await recordAuditSafe(null, {
      action: "auth.sign_in_link_requested",
      target: user || { email },
      req,
    });
    if (user && user.active && user.authProvider === "local" && user._count.passkeys === 0) {
      await sendSignInLinkEmail(user);
    }
  } catch {
    // Deliberately swallowed: this endpoint must never signal a difference.
  }
});

// Spends the emailed link. Proves the inbox, not a second factor: the person is then taken to
// whatever the account still needs (a code, or adding a passkey), exactly as after a password.
router.post("/passwordless/link/redeem", async (req, res, next) => {
  try {
    if (!(await isPasswordlessOn())) return res.status(404).json({ error: "Not found" });
    const user = await redeemSignInLink(req.body?.token);
    if (!user) {
      return res.status(400).json({ error: "This link has expired or was already used. Ask for a new one." });
    }
    res.json(await afterFirstFactor(res, user, req));
  } catch (err) {
    next(err);
  }
});

// Second step of login for accounts with MFA enabled — exchanges the
// short-lived pending token (proof the password already checked out) plus
// a valid TOTP code for a real session token.
router.post("/mfa/login-verify", async (req, res, next) => {
  try {
    const { pendingToken, token } = req.body;
    if (!pendingToken || !token) {
      return res.status(400).json({ error: "pendingToken and token are required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(pendingToken, process.env.SESSION_SECRET);
    } catch {
      return res.status(401).json({ error: "MFA session expired, please log in again" });
    }
    if (!decoded.mfaPending) return res.status(401).json({ error: "Invalid MFA session" });

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.active || !user.mfaEnabled || !user.mfaSecret) {
      return res.status(401).json({ error: "Invalid MFA session" });
    }

    const { valid, timeStep } = await verifyOtp({
      secret: decryptField(user.mfaSecret),
      token: String(token),
      // Refuse a code this account has already used. A TOTP code is valid
      // for its whole 30-second window, so without this one observed code
      // -- shoulder-surfed, phished, or read off a shared screen -- can be
      // replayed by someone else until it expires.
      afterTimeStep: user.mfaLastTimeStep ?? undefined,
    });
    if (!valid) {
      await recordAuditSafe(null, {
        action: "auth.login_failed",
        target: user,
        req,
        details: { reason: "wrong_two_factor_code" },
      });
      return res.status(401).json({ error: "Invalid code" });
    }

    await prisma.user.update({ where: { id: user.id }, data: { mfaLastTimeStep: timeStep } });

    res.json(await completeLogin(res, user, req));
  } catch (err) {
    next(err);
  }
});

// Looked up fresh from the DB (rather than just echoing the JWT claims) so
// mfaEnabled reflects reality even if it changed since the token was issued
// (e.g. an admin reset it, or the user just enrolled).
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    // active, not just existence -- a deactivated account was still being
    // told who it was here, even though requireAuth now rejects it upstream.
    if (!user || !user.active) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    // twoFactorRequired: the church-wide requirement (#385), so My account can say it is
    // required and hide the switch-off, and the admin toggle can show its state.
    res.json({
      user: {
        ...(await sanitizeUser(user)),
        twoFactorRequired: await isTwoFactorRequired(),
        // #386 Layer 2, for the Manage Users switch: is it on, and can email carry a sign-in link.
        passwordlessRequired: await isPasswordlessOn(),
        emailReady: await isEmailReady(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Self-service password change — requires knowing the current password,
// unlike the admin-only reset in routes/users.js.
//
//
// #356: a guest may change their own password here, like every other role.
// #329 Finding 2 had blocked it while the Trip Leader tier was fully
// admin-managed; guests now get a "My account" page (password and MFA
// self-service), so the backend no longer disagrees with the UI.
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    const parsedNewPassword = passwordSchema.safeParse(newPassword);
    if (!parsedNewPassword.success) {
      return res
        .status(400)
        .json({ error: `New ${parsedNewPassword.error.issues[0].message.toLowerCase()}` });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || user.authProvider !== "local" || !user.passwordHash) {
      return res.status(400).json({ error: "This account can't change its password here" });
    }

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // #327 Finding 7: bumping sessionVersion invalidates every *other*
    // session this account has open elsewhere -- re-issuing the cookie
    // here with the updated row keeps this tab's own session working
    // seamlessly (its next request already carries the new version).
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    setSessionCookie(res, updated);
    await recordAuditSafe(null, { action: "auth.password_changed", actor: user, req });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- First-time password setup (welcome-email link) ---
// Public by necessity: the person has no account access yet. The only
// credential is the single-use, expiring token from their welcome email
// (utils/passwordSetup.js). Every failure answers with the same generic
// message so a caller can't tell a wrong token from an expired or used one.
const SETUP_LINK_INVALID = "This link is invalid or has expired.";

// #327 Finding 6: was GET with the token in the query string -- a real,
// usable credential traveling in a URL that gets written to access logs
// (see the morgan redaction fix above) and can leak via a Referer header
// or browser history. POST with the token in the body instead, same
// pattern /password-setup/complete below already uses.
router.post("/password-setup/validate", async (req, res, next) => {
  try {
    const row = await findValidSetupToken(String(req.body?.token || ""));
    if (!row) return res.status(400).json({ error: SETUP_LINK_INVALID });
    res.json({
      email: row.user.email,
      firstName: row.user.firstName || null,
      mfaRequired: row.user.mfaSetupRequired || (await isTwoFactorRequired()),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/password-setup/complete", async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) {
      return res.status(400).json({ error: parsedPassword.error.issues[0].message });
    }
    const row = await findValidSetupToken(String(token || ""));
    if (!row) return res.status(400).json({ error: SETUP_LINK_INVALID });
    if (password.toLowerCase() === row.user.email.toLowerCase()) {
      return res.status(400).json({ error: "Password can't be the same as your email address" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    // One transaction: set the password, burn this link, and drop any other
    // outstanding links for the account so none can be replayed.
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      prisma.passwordSetupToken.deleteMany({
        where: { userId: row.userId, tokenHash: { not: hashToken(String(token)) } },
      }),
      prisma.passwordSetupToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    await recordAuditSafe(null, { action: "auth.password_set", actor: row.user, req });
    // Not signed in here on purpose: they sign in normally next, which also
    // runs the forced two-factor enrollment when it's required.
    res.json({ ok: true, mfaRequired: row.user.mfaSetupRequired || (await isTwoFactorRequired()) });
  } catch (err) {
    next(err);
  }
});

// "Send me a new link." The same reply for every email address (one message while email
// works, another while it is off), and the email goes out after responding, so neither the
// message nor the response time reveals whether an account exists.
router.post("/password-setup/request", async (req, res) => {
  // Whether this site can send email at all is a church-wide fact, the same for every
  // request, so saying so reveals nothing about any account: with email off, nobody gets a
  // link, so the page says to ask an administrator instead of leaving them waiting for one.
  // A failed lookup falls back to the generic reply.
  let emailOn = true;
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: { enabledFeatures: true },
    });
    emailOn = isFeatureEnabled(settings?.enabledFeatures, "outboundEmail");
  } catch {
    // keep the generic reply
  }
  res.json(
    emailOn
      ? {
          ok: true,
          message: "If that email has an account waiting to be set up, a new link is on its way.",
        }
      : {
          ok: true,
          emailOff: true,
          message:
            "This site can't send email, so we can't send a new link. Please ask your church administrator for a new setup link.",
        }
  );
  try {
    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    if (!email) return;
    const user = await prisma.user.findUnique({ where: { email } });
    await recordAuditSafe(null, {
      action: "auth.password_reset_requested",
      target: user || { email },
      req,
    });
    // No send when email is off (nothing could go out, and an admin hands over a link instead,
    // as users.js does). sendWelcomeEmail throws when outboundEmail is off; skipping it here is
    // deliberate, not left to the catch below.
    if (emailOn && user && user.active && user.authProvider === "local" && !user.passwordHash) {
      await sendWelcomeEmail(user, { requireMfa: user.mfaSetupRequired });
    }
  } catch {
    // Deliberately swallowed: this endpoint must never signal a difference.
  }
});

// --- TOTP MFA enrollment/management (self-service, opt-in) ---

// Generates a new secret and returns a QR code to scan; mfaEnabled stays
// false until the code is confirmed via /mfa/verify-setup below, so an
// abandoned setup attempt never leaves the account half-configured.
router.post("/mfa/setup", requireAuthOrMfaSetup, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || user.authProvider !== "local") {
      return res.status(400).json({ error: "MFA is only available for local accounts" });
    }
    if (user.mfaEnabled) {
      return res.status(400).json({ error: "MFA is already enabled — disable it first to re-enroll" });
    }

    const secret = generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encryptField(secret) } });

    // The QR code / manual-entry value must be the raw secret — encryption
    // is only for what's persisted to the database.
    const otpauth = generateURI({ issuer: MFA_ISSUER, label: user.email, secret });
    const qrCode = await QRCode.toDataURL(otpauth);

    res.json({ secret, qrCode });
  } catch (err) {
    next(err);
  }
});

// Confirms setup by checking a real code from the authenticator app, which
// also proves the QR code was actually scanned successfully before MFA
// becomes mandatory on future logins. Always hands back a fresh full
// session — for the voluntary Account Settings flow the caller already has
// one and can ignore it, but for a forced-setup token (no session yet) this
// is what actually lets the user in once they've enrolled.
router.post("/mfa/verify-setup", requireAuthOrMfaSetup, async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Code is required" });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.mfaSecret || user.mfaEnabled) {
      return res.status(400).json({ error: "No MFA setup in progress" });
    }

    const { valid, timeStep } = await verifyOtp({
      secret: decryptField(user.mfaSecret),
      token: String(token),
      afterTimeStep: user.mfaLastTimeStep ?? undefined,
    });
    if (!valid) return res.status(401).json({ error: "Invalid code" });

    // #327 Finding 7: completeLogin below re-issues the session cookie
    // from this same updated row, so the bump takes effect for this tab
    // immediately -- only sessions opened before enrollment are the ones
    // actually invalidated.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaSetupRequired: false,
        mfaLastTimeStep: timeStep,
        sessionVersion: { increment: 1 },
      },
    });
    await recordAuditSafe(null, { action: "auth.mfa_enabled", actor: updated, req });
    res.json(await completeLogin(res, updated, req));
  } catch (err) {
    next(err);
  }
});

// Requires the current password (not just an active session) so a hijacked
// browser tab can't silently strip MFA off the account.
//
// While the church requires two-factor of everyone (#385) nobody, whatever their role, can
// switch it off here -- an admin who needs to clear a lost authenticator uses
// routes/users.js's admin-side MFA reset (POST /api/users/:id/mfa/reset), after which the
// person is taken through enrolment again at next sign-in.
router.post("/mfa/disable", requireAuth, async (req, res, next) => {
  try {
    // While the church requires two-factor, nobody can turn it off for themselves (#385).
    if (await isTwoFactorRequired()) {
      return res.status(403).json({ error: "Your church requires two-factor authentication" });
    }
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Current password is required" });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.passwordHash) return res.status(400).json({ error: "Invalid account" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    // #327 Finding 7: same reasoning as change-password above -- re-issue
    // this tab's own cookie from the updated row so only other sessions
    // are the ones that stop working.
    // #386: passkeys are a second factor too; the switch only goes off when none are left.
    const hasPasskeys = (await prisma.userPasskey.count({ where: { userId: user.id } })) > 0;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaSecret: null,
        mfaEnabled: hasPasskeys,
        sessionVersion: { increment: 1 },
      },
    });
    setSessionCookie(res, updated);
    await recordAuditSafe(null, { action: "auth.mfa_disabled", actor: updated, req });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Self-service cadence + scope picker for the batched notification
// digest email (see #129, #202) -- same self-service-from-Account-
// Settings pattern as MFA enroll/disable above, just a plain preference
// instead of a real credential check (nothing sensitive being turned on
// here, so no password confirmation needed the way MFA disable
// requires one). Replaces the #202-phase-1 stopgap that only took a
// plain { enabled } boolean -- this is the real cadence/scope picker
// the Account Settings UI now has.
//
// allPartners: true always clears any existing UserFollowedPartner rows
// for this account, rather than just leaving them unread -- same
// reasoning as cadence: null doing the same below: stale scope data
// sitting around unread is exactly the kind of drift that turns into a
// bug the next time someone toggles allPartners back to false and gets
// a list they don't recognize. Cheaper to not have it than to trust
// every future reader to ignore it correctly.
const digestSubscriptionSchema = z.object({
  cadence: z.enum(["biweekly", "monthly", "quarterly"]).nullable(),
  allPartners: z.boolean().optional().default(true),
  partnerIds: z.array(z.string()).optional().default([]),
});
router.put("/dispatch-by-email", requireAuth, async (req, res, next) => {
  try {
    // The admin digest carries every partner's prayer requests, needs and amounts, which a scoped
    // guest must never receive (#407). The UI hides this for a guest; the server refuses it too.
    if (req.user.role === "guest") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const parsed = digestSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    }
    const { cadence, allPartners, partnerIds } = parsed.data;

    // Unlike the public subscribe route (which silently drops an invalid
    // id, to avoid giving an anonymous caller any signal about what
    // exists), this is an authenticated admin/editor/viewer route --
    // there's no enumeration concern, so a bad id is a real 400, not a
    // silent drop. Admins aren't restricted to public partners the way a
    // public subscriber is ("auth is the boundary," an admin already
    // sees every partner regardless of isPublic), so this only excludes
    // archived ones, not non-public ones.
    let validPartnerIds = [];
    if (!cadence || allPartners) {
      // Nothing to validate -- either unsubscribing entirely or
      // following everyone, so any partnerIds sent are simply ignored
      // rather than erroring on them (the field is irrelevant in both
      // states, not invalid).
    } else if (partnerIds.length === 0) {
      return res.status(400).json({ error: "Pick at least one partner, or choose all partners" });
    } else {
      const found = await prisma.partner.findMany({
        where: { id: { in: partnerIds }, archived: false },
        select: { id: true },
      });
      if (found.length !== partnerIds.length) {
        return res.status(400).json({ error: "One or more selected partners couldn't be found" });
      }
      validPartnerIds = found.map((p) => p.id);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data: { cadence, allPartners },
      }),
      prisma.userFollowedPartner.deleteMany({ where: { userId: req.user.id } }),
      ...(validPartnerIds.length
        ? [
            prisma.userFollowedPartner.createMany({
              data: validPartnerIds.map((partnerId) => ({ userId: req.user.id, partnerId })),
            }),
          ]
        : []),
    ]);

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    res.json({ user: await sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/key-date-email -- the daily key-date email for the people on a care team
// (#365). Anyone signed in may turn their own off or back on (a care team guest included);
// the bell alert is unaffected, and the church-wide settings still decide whether the email
// exists at all.
router.put("/key-date-email", requireAuth, async (req, res, next) => {
  try {
    const { optOut } = z.object({ optOut: z.boolean() }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { keyDateEmailOptOut: optOut },
    });
    res.json({ user: await sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/unsubscribe -- public, no requireAuth, reached straight
// from a link in a digest email (see utils/emailDispatchShell.js's
// buildUnsubscribeUrl). Verifies the same { id, unsubscribe: true }
// token shape/signing as the MFA-pending/MFA-setup tokens above, minted
// fresh per recipient per email, with a 90-day expiry (#327 Finding 1 --
// generous enough that an old, saved email's unsubscribe link still
// works, but not forever). This jwt.verify call is this route's own --
// separate from, and not gated by, middleware/requireAuth, so an expired
// token here fails the same way any other invalid token does below, and
// never touches requireAuth's own unrelated rejection of
// decoded.unsubscribe (that check exists so this token can never be
// presented as a *session cookie* instead; it has nothing to do with
// this route verifying it directly). Renders a plain HTML confirmation
// page, not JSON -- this is a link a person clicks in their mail client,
// not an API call.
// Shared by both routes below -- same branding lookup and page shell
// either way, only the body message and whether a confirm form is shown
// differ. `message` is a plain string, or a (highlightColor) => string
// function for a caller that needs the real brand color inline (the
// confirm button) without a second settings query.
async function renderUnsubscribePage(message) {
  // Branded to match the digest email's own header-band treatment (see
  // utils/emailDispatchShell.js) -- same colors/font, same fallbacks, so
  // this doesn't look like a different, unbranded app once clicked into
  // from the email. highlightColor matches that same file's own
  // button/link color convention (typeLabel/button helpers), not
  // headerColor, which is only ever the header band's background here.
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: {
      churchName: true,
      headerColor: true,
      highlightColor: true,
      logoContentType: true,
      brandFont: true,
    },
  });
  const churchName = settings?.churchName || "Missions Partner Tracker";
  const headerColor = settings?.headerColor || "#2c2a28";
  const highlightColor = settings?.highlightColor || "#a6540f";
  const fontFamily =
    settings?.brandFont || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const base = appBaseUrl();
  const logoHtml =
    settings?.logoContentType && base
      ? `<img src="${base}/api/public/settings/logo/raw" alt="${escapeHtml(churchName)}" style="max-height:40px;width:auto;max-width:240px;margin-bottom:10px;">`
      : "";
  const body = typeof message === "function" ? message(highlightColor) : message;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Email notifications</title></head>
<body style="font-family:${escapeHtml(fontFamily)};background:#f7f5f0;margin:0;padding:40px 16px;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
  <div style="background-color:${headerColor};padding:28px 24px;text-align:center;">
    ${logoHtml}
    <h2 style="margin:0;color:#ffffff;font-size:18px;">${escapeHtml(churchName)}</h2>
  </div>
  <div style="padding:32px 24px;text-align:center;color:#222;">
    <p style="margin:0;font-size:16px;line-height:1.5;">${body}</p>
  </div>
</div>
</body></html>`;
}

function verifyUnsubscribeToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ""), process.env.SESSION_SECRET);
  } catch {
    return null;
  }
  return decoded?.unsubscribe && decoded.id ? decoded : null;
}

// #327 Finding 6: this used to unsubscribe the moment the link was
// *fetched* -- a mail security scanner that pre-fetches every link in an
// inbox would silently unsubscribe someone who never clicked anything
// themselves. GET now only verifies the token and renders a page with a
// real confirm button (a plain <form method="POST">, so it still works
// with no JavaScript, same constraint that made this a GET in the first
// place); POST below is what actually unsubscribes. List-Unsubscribe-Post
// support (RFC 8058) lets a mail client's own native "Unsubscribe" button
// call the POST route directly without ever rendering this page -- see
// emailDispatchShell.js's List-Unsubscribe header for where that's wired
// up.
router.get("/unsubscribe", async (req, res) => {
  const decoded = verifyUnsubscribeToken(req.query.token);
  if (!decoded)
    return res.status(400).send(await renderUnsubscribePage("This unsubscribe link isn't valid."));
  const token = escapeHtml(String(req.query.token));
  res.send(
    await renderUnsubscribePage(
      (highlightColor) =>
        `Click below to unsubscribe from email notifications.<br><br><form method="POST" action="/api/auth/unsubscribe"><input type="hidden" name="token" value="${token}"><button type="submit" style="background:${highlightColor};color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:15px;cursor:pointer;">Confirm unsubscribe</button></form>`
    )
  );
});

// token in req.body (the confirm-button form above) or req.query (RFC
// 8058 one-click: a mail client's own native button POSTs straight to
// the URL List-Unsubscribe named -- token in the URL, not a form field
// it has no reason to know about -- with a fixed
// "List-Unsubscribe=One-Click" body per spec).
router.post("/unsubscribe", express.urlencoded({ extended: false }), async (req, res) => {
  const decoded = verifyUnsubscribeToken(req.body?.token || req.query?.token);
  if (!decoded)
    return res.status(400).send(await renderUnsubscribePage("This unsubscribe link isn't valid."));

  // Same "don't leave stale scope data around" reasoning as PUT
  // /dispatch-by-email's own cadence: null handling above.
  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: decoded.id }, data: { cadence: null } }),
    prisma.userFollowedPartner.deleteMany({ where: { userId: decoded.id } }),
  ]);
  res.send(await renderUnsubscribePage("You've been unsubscribed from email notifications."));
});

router.post("/logout", (req, res) => {
  // The session lives in an httpOnly cookie, so client-side JS can't clear
  // it itself — this is the only way to actually log out.
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Async now (#202 phase 2) -- a separate small query for followedPartner
// ids rather than requiring every one of this file's own `prisma.user`
// queries to remember an `include`. Only actually queries when there's
// something to find (allPartners: false with a real subscription) --
// the common cases (not subscribed, or subscribed to everyone) skip it
// entirely, same "the cheapest data to fetch is data you never queried"
// discipline this codebase already applies elsewhere.
async function sanitizeUser(user) {
  let partnerIds = [];
  if (user.cadence && !user.allPartners) {
    const rows = await prisma.userFollowedPartner.findMany({
      where: { userId: user.id },
      select: { partnerId: true },
    });
    partnerIds = rows.map((r) => r.partnerId);
  }
  // Guest tier only -- the trips their active grants reach, as short
  // labels for the sidebar's own minimal nav (AdminSidebar.jsx), not full
  // Trip records. Looked up here rather than left for the frontend to
  // fetch separately, since a guest has no route that would otherwise
  // ever hand them this. partnerId/partnerLabel let that same sidebar
  // link to the Partner each trip belongs to (Trip.partnerId is optional
  // -- a trip with no linked partner yet means no such link to show).
  //
  // #356: partnerLabel prefers displayName over fieldDisplayName. The
  // sidebar used to show the field alias while the partner page it links
  // to shows the real name, so the link and its destination disagreed.
  let guestTrips = [];
  // The partners this login is on the care team of (#289) -- [{ id, label,
  // isLead }] -- for every role: a full role gets the marker and the
  // "My partners" view, a guest also reaches the partner through it, and
  // any non-staff member may submit prayers/needs for it. Empty while the
  // careTeam feature is off, since seats are ignored then.
  let careTeamSeats = [];
  if (user.role === "guest") {
    const grants = (await listTripGrants(user.id)).filter((g) => g.active);
    const partners = await prisma.partner.findMany({
      where: { id: { in: grants.map((g) => g.trip.partnerId).filter(Boolean) } },
      select: { id: true, displayName: true, fieldDisplayName: true },
    });
    const partnerById = new Map(partners.map((p) => [p.id, p]));
    guestTrips = grants.map((g) => {
      const partner = partnerById.get(g.trip.partnerId);
      const partnerLabel = partner?.displayName || partner?.fieldDisplayName || null;
      return {
        id: g.tripId,
        label: g.trip.name || g.trip.type || partnerLabel || "Your trip",
        partnerId: g.trip.partnerId,
        partnerLabel,
        expiresAt: g.effectiveExpiresAt,
      };
    });
  }
  if (await isCareTeamEnabled()) {
    const seats = await prisma.careTeamMember.findMany({
      where: { userId: user.id },
      select: { isLead: true, partner: { select: { id: true, displayName: true, fieldDisplayName: true } } },
      orderBy: { createdAt: "asc" },
    });
    careTeamSeats = seats.map((s) => ({
      id: s.partner.id,
      label: s.partner.displayName || s.partner.fieldDisplayName || "Partner",
      isLead: s.isLead,
    }));
  }
  // Every trip a guest may OPEN: the ones they hold a grant for (read and
  // write) plus, through a care team seat, every trip of that partner (read
  // only, #289). The frontend's route guard uses this so a guest is only ever
  // sent to pages the server will actually show them.
  let guestReadTripIds = [];
  if (user.role === "guest") {
    const ids = new Set(guestTrips.map((t) => t.id));
    if (careTeamSeats.length > 0) {
      const viaSeats = await prisma.trip.findMany({
        where: { partnerId: { in: careTeamSeats.map((s) => s.id) } },
        select: { id: true },
      });
      viaSeats.forEach((t) => ids.add(t.id));
    }
    guestReadTripIds = [...ids];
  }
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    authProvider: user.authProvider,
    mfaEnabled: user.mfaEnabled,
    authenticatorApp: Boolean(user.mfaEnabled && user.mfaSecret),
    passkeyCount: await prisma.userPasskey.count({ where: { userId: user.id } }),
    cadence: user.cadence,
    allPartners: user.allPartners,
    followedPartnerIds: partnerIds,
    keyDateEmailOptOut: user.keyDateEmailOptOut === true,
    guestTrips,
    guestReadTripIds,
    careTeamSeats,
  };
}

// #386: passkeys, mounted here so they can finish a sign-in the same way a code does.
router.use("/passkeys", require("./passkeys")({ completeLogin }));

module.exports = router;
