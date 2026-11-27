const express = require("express");
const { isOutboundEmailReady, READY_SELECT } = require("../utils/emailReady");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { phoneSchema } = require("../utils/contactFormat");
const { generateSecret, generateURI, verify: verifyOtp } = require("otplib");
const QRCode = require("qrcode");
const prisma = require("../prismaClient");
const { requireAuth, requireAuthOrMfaSetup } = require("../middleware/requireAuth");
const { setSessionCookie, clearSessionCookie } = require("../utils/jwt");
const { encryptField, decryptField } = require("../utils/crypto");
const { appBaseUrl } = require("../utils/dispatchBlurbs");
const { escapeHtml } = require("../utils/emailDispatchShell");
const { findValidSetupToken, hashToken, RESET_COOLDOWN_MS } = require("../utils/passwordSetup");
const { sendWelcomeEmail, sendPasswordResetEmail } = require("../utils/welcomeEmails");
const { listTripGrants, isCareTeamEnabled } = require("../utils/guestAccess");
const { passwordSchema } = require("../utils/password");
const { recordAuditSafe } = require("../utils/auditLog");
const { isTwoFactorRequired } = require("../utils/twoFactor");
const {
  issueRecoveryCodes,
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
} = require("../utils/recoveryCodes");
const {
  isDemoDeployment,
  isGuardedDemo,
  endOtherSessions,
  refuseOnGuardedDemo,
} = require("../utils/demoMode");
const accountLoginLimiter = require("../utils/accountLoginLimiter");
const { configuredOrigin } = require("../utils/passkeys");

const noPasswordChangeOnDemo = refuseOnGuardedDemo("Changing the password");
const {
  isPasswordlessOn,
  isPasskeySignInOn,
  demoBlocksPasswordless,
  isEmailReady,
  redeemSignInLink,
  sendSignInLinkEmail,
  LINK_COOLDOWN_MS,
} = require("../utils/passwordless");

const router = express.Router();
const MFA_PENDING_TTL = "5m";
const MFA_SETUP_TTL = "20m";
// A real bcrypt hash of a value nobody can supply, used only to burn the same
// CPU time a genuine comparison would. Generated at startup so it never looks
// like a credential.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-such-account-placeholder", 12);

// Shown next to the account in the user's authenticator app.
const MFA_ISSUER = process.env.MFA_ISSUER || "Missions Partner Tracker Admin";

function signMfaPendingToken(user) {
  return jwt.sign({ id: user.id, mfaPending: true }, process.env.SESSION_SECRET, {
    expiresIn: MFA_PENDING_TTL,
  });
}

// For a user who must enrol in MFA but hasn't yet: long enough to install an
// authenticator app and scan the QR code, but not a real session.
function signMfaSetupToken(user) {
  return jwt.sign({ id: user.id, mfaSetup: true }, process.env.SESSION_SECRET, {
    expiresIn: MFA_SETUP_TTL,
  });
}

// Shared by the non-MFA and post-MFA login paths; records the login only once a
// session is granted. The token is set as a cookie on `res`, never in the JSON
// body, so frontend JS has nothing to read or store.
async function completeLogin(res, user, req) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAuditSafe(null, { action: "auth.login_success", actor: user, req });
  setSessionCookie(res, user);
  return { user: await sanitizeUser(user) };
}

// What follows a proven first factor (password or spent emailed link): a second
// factor to check, enrolment to finish, or the session itself.
async function afterFirstFactor(res, user, req) {
  // A public demo never asks for a second factor: one a visitor added to a
  // shared login must not lock anyone else out.
  if (isDemoDeployment()) return completeLogin(res, user, req);
  if (user.mfaEnabled) {
    const passkeyCount = await prisma.userPasskey.count({ where: { userId: user.id } });
    return {
      mfaRequired: true,
      pendingToken: signMfaPendingToken(user),
      methods: { authenticatorApp: Boolean(user.mfaSecret), passkey: passkeyCount > 0 },
    };
  }
  // Not enrolled: no session until enrolment is finished, when the church
  // requires two-factor of everyone (passwordless implies it) or an admin
  // required it of this account.
  if (user.mfaSetupRequired || (await isTwoFactorRequired())) {
    return { mfaSetupRequired: true, setupToken: signMfaSetupToken(user) };
  }
  return completeLogin(res, user, req);
}

// First-run setup: both routes are public (no session exists yet) but
// self-disable once a real account exists.

// Lets the frontend route a fresh deploy to account creation (see Login.jsx).
router.get("/setup-status", async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    // `passwordless`: the sign-in page offers a passkey and an emailed link, not a password.
    // `passwordReset`: "Forgot your password?" needs working email, a password to
    // reset (not passwordless), and a real church (never a shared demo login).
    const passwordless = await isPasswordlessOn();
    // `passkeySignIn`: the church allows it (or passwordless is on), so the sign-in page offers
    // "Sign in with a passkey" beside the password form.
    const passkeySignIn = await isPasskeySignInOn();
    res.json({
      needed: count === 0,
      passwordless,
      passkeySignIn,
      passwordReset: !passwordless && !isDemoDeployment() && (await isEmailReady()),
    });
  } catch (err) {
    next(err);
  }
});

// Fixed key for the Postgres advisory lock that makes first-run setup a single step (see below).
const SETUP_LOCK_KEY = 7204117102;

// Only ever succeeds once. Checking that no account exists and creating the first one are done as ONE
// step: a transaction that first takes a lock only setup uses, so two requests arriving at the same
// moment cannot both pass the check (before this, three at once all became admins, and a second
// request landing while the first was still hashing its password left a second, unseen admin).
// The password is hashed before the lock so the lock is held only for the check and the writes.
router.post("/setup", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) {
      return res.status(400).json({ error: parsedPassword.error.issues[0].message });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await prisma.$transaction(async (tx) => {
      // Waits here until any other setup request has finished; released when this transaction ends.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY}::bigint)::text`;
      if ((await tx.user.count()) > 0) return false;

      await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          passwordHash,
          role: "admin",
          authProvider: "local",
          // Nobody else is on the missions team yet. The contact log and key-date reminders go to whoever
          // looks after a partner (its care team, else the missions team), so without this they would
          // notify no one until an admin found the switch on the user's own page.
          onMissionsTeam: true,
        },
      });

      // A fresh install starts with the church-wide two-factor requirement ON;
      // the first admin can turn it off. Upsert, not create: only zero prior
      // Users is guaranteed, not zero prior ChurchSettings.
      await tx.churchSettings.upsert({
        where: { id: "singleton" },
        update: { requireTwoFactor: true },
        create: { id: "singleton", requireTwoFactor: true },
      });
      return true;
    });

    if (!created) {
      return res.status(409).json({
        error:
          "Setup has already been completed for this instance. If you did not create that account, redeploy to start again.",
      });
    }
    // No session yet: with the requirement on, an unenrolled account can't use
    // one. The first admin signs in (POST /login) and is taken through enrolment.
    res.status(201).json({ ok: true, mfaSetupRequired: true });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    // With passwordless on, nobody signs in with a password. Church-wide, so it
    // reveals nothing about any account.
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

    // Too many failed sign-ins for this ACCOUNT, from anywhere (the per-address limits in server.js
    // can be dodged by changing address). Refused before the password is even checked, so a guesser
    // learns nothing from the answer. Not on a public demo, whose logins are shared and published.
    const limitDemo = isGuardedDemo();
    if (!limitDemo) {
      const wait = accountLoginLimiter.retryAfterSeconds("login", email);
      if (wait > 0) {
        res.set("Retry-After", String(wait));
        return res.status(429).json({
          error: `Too many failed sign-ins for this account. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`,
        });
      }
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
      if (!limitDemo) accountLoginLimiter.recordFailure("login", email);
      await recordAuditSafe(null, {
        action: "auth.login_failed",
        target: user || { email: email.toLowerCase().trim() },
        req,
        details: { reason },
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    accountLoginLimiter.clearFailures("login", email);
    res.json(await afterFirstFactor(res, user, req));
  } catch (err) {
    next(err);
  }
});

// "Email me a sign-in link." The same reply for every address, and the email
// goes out after responding, so neither the message nor the response time
// reveals whether an account exists. Only an account with no passkey gets one,
// so an inbox alone never replaces a passkey (a lost one is an admin Reset MFA).
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
    // Only a real account is audited: unknown addresses would let anyone flood the audit log.
    if (!user) return;
    await recordAuditSafe(null, { action: "auth.sign_in_link_requested", target: user, req });
    if (user.active && user.authProvider === "local" && user._count.passkeys === 0) {
      // One link a minute per account: otherwise anyone could mail-bomb a person,
      // or keep replacing their live link (each new one deletes the last).
      const recent = await prisma.signInLinkToken.count({
        where: { userId: user.id, createdAt: { gt: new Date(Date.now() - LINK_COOLDOWN_MS) } },
      });
      if (recent === 0) await sendSignInLinkEmail(user);
    }
  } catch {
    // Deliberately swallowed: this endpoint must never signal a difference.
  }
});

// Spends the emailed link. Proves the inbox, not a second factor: the account
// then gets whatever it still needs (a code, or a passkey), as after a password.
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

// Second step of login with MFA: exchanges the short-lived pending token plus a
// valid TOTP code for a session.
router.post("/mfa/login-verify", async (req, res, next) => {
  try {
    const { pendingToken, token, recoveryCode } = req.body;
    if (!pendingToken || (!token && !recoveryCode)) {
      return res.status(400).json({ error: "pendingToken and a code are required" });
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

    // Wrong two-factor codes are limited per account too, separately from passwords: someone who has
    // the password can still only try so many codes, wherever they come from.
    const limitMfa = isGuardedDemo();
    if (!limitMfa) {
      const wait = accountLoginLimiter.retryAfterSeconds("mfa", user.email);
      if (wait > 0) {
        res.set("Retry-After", String(wait));
        return res.status(429).json({
          error: `Too many wrong codes for this account. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`,
        });
      }
    }

    // A recovery code stands in for the authenticator app, so it shares the wrong-code limit above.
    let valid = false;
    let timeStep;
    if (recoveryCode) {
      valid = await consumeRecoveryCode(user.id, recoveryCode);
    } else {
      ({ valid, timeStep } = await verifyOtp({
        secret: decryptField(user.mfaSecret),
        token: String(token),
        // Refuse a code already used: a TOTP code is valid for its whole window,
        // so without this an observed code could be replayed until it expires.
        afterTimeStep: user.mfaLastTimeStep ?? undefined,
      }));
    }
    if (!valid) {
      if (!limitMfa) accountLoginLimiter.recordFailure("mfa", user.email);
      await recordAuditSafe(null, {
        action: "auth.login_failed",
        target: user,
        req,
        details: { reason: recoveryCode ? "wrong_recovery_code" : "wrong_two_factor_code" },
      });
      return res.status(401).json({
        error: recoveryCode ? "That recovery code is not valid or was already used" : "Invalid code",
      });
    }

    accountLoginLimiter.clearFailures("mfa", user.email);
    if (recoveryCode) {
      await recordAuditSafe(null, { action: "auth.recovery_code_used", actor: user, req });
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { mfaLastTimeStep: timeStep } });
    }

    const result = await completeLogin(res, user, req);
    if (recoveryCode) result.recoveryCodesRemaining = await countUnusedRecoveryCodes(user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Looked up fresh from the DB, not echoed from the JWT claims, so mfaEnabled
// reflects changes since the token was issued.
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    // Check `active`, not just existence: a deactivated account must not be told who it is.
    if (!user || !user.active) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    // twoFactorRequired: the church-wide requirement, so My account can hide the switch-off.
    res.json({
      user: {
        ...(await sanitizeUser(user)),
        twoFactorRequired: await isTwoFactorRequired(),
        // For the Manage Users switch: is passwordless on, and can email carry a sign-in link.
        passwordlessRequired: await isPasswordlessOn(),
        // The public demo refuses to switch passwordless sign-in on (the owner's test deployment may allow it).
        passwordlessBlockedByDemo: demoBlocksPasswordless(),
        // The raw church setting (the Manage Users switch); isPasskeySignInOn also counts passwordless mode.
        allowPasskeySignIn:
          (
            await prisma.churchSettings.findUnique({
              where: { id: "singleton" },
              select: { allowPasskeySignIn: true },
            })
          )?.allowPasskeySignIn === true,
        emailReady: await isEmailReady(),
        // The address the site is set to (APP_BASE_URL), for the admin banner shown when the browser is at another
        // one: passkeys only work at this address. Admins only; null when none is set.
        configuredSiteOrigin: user.role === "admin" ? configuredOrigin() : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Self-service password change; requires the current password, unlike the
// admin-only reset in routes/users.js. Open to every role, guests included.
router.post("/change-password", requireAuth, noPasswordChangeOnDemo, async (req, res, next) => {
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
    // Bumping sessionVersion invalidates every other open session; re-issuing
    // the cookie from the updated row keeps this tab's own session working.
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

// Password setup/reset via emailed link. Public by necessity: the only
// credential is the single-use, expiring token (utils/passwordSetup.js). Every
// failure gives the same generic message so a caller can't tell a wrong token
// from an expired or used one.
const SETUP_LINK_INVALID = "This link is invalid or has expired.";

// POST with the token in the body, never GET: a credential in a URL lands in
// access logs, Referer headers and browser history.
router.post("/password-setup/validate", async (req, res, next) => {
  try {
    const row = await findValidSetupToken(String(req.body?.token || ""));
    if (!row) return res.status(400).json({ error: SETUP_LINK_INVALID });
    res.json({
      email: row.user.email,
      firstName: row.user.firstName || null,
      // The page words a reset (account already has a password) differently from first-time setup.
      reset: Boolean(row.user.passwordHash),
      mfaRequired: row.user.mfaSetupRequired || (await isTwoFactorRequired()),
      // The guided page offers only what this site allows and what this account can still be given. An
      // account that already has two-factor is never handed a new one by a link alone (see /complete).
      hasSecondFactor: Boolean(row.user.mfaEnabled) && Boolean(row.user.passwordHash),
      passwordAllowed: !(await isPasswordlessOn()),
      passkeyAllowed: await isPasskeySignInOn(),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/password-setup/complete", noPasswordChangeOnDemo, async (req, res, next) => {
  try {
    if (await isPasswordlessOn()) {
      return res.status(403).json({ error: "This church signs in with a passkey, not a password" });
    }
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
    // A reset also ends every other session, like changing the password, so
    // whoever had the old password is signed out (endOtherSessions skips demos,
    // whose logins are shared).
    const isReset = Boolean(row.user.passwordHash);
    // A passkey-only account (no password yet, but two-factor on) choosing a password is the lost-device
    // case: its old passkeys go, or the person would be asked for the one they lost.
    const replacingPasskeys = row.user.mfaEnabled && !isReset;
    await prisma.$transaction([
      ...(replacingPasskeys
        ? [
            prisma.userPasskey.deleteMany({ where: { userId: row.userId } }),
            prisma.userRecoveryCode.deleteMany({ where: { userId: row.userId } }),
          ]
        : []),
      // One transaction: set the password, burn this link, and drop the account's
      // other outstanding links so none can be replayed.
      prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          ...(isReset || replacingPasskeys ? endOtherSessions() : {}),
          ...(replacingPasskeys ? { mfaEnabled: false, mfaSecret: null } : {}),
        },
      }),
      prisma.passwordSetupToken.deleteMany({
        where: { userId: row.userId, tokenHash: { not: hashToken(String(token)) } },
      }),
      prisma.passwordSetupToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    await recordAuditSafe(null, {
      action: isReset ? "auth.password_reset" : "auth.password_set",
      actor: row.user,
      req,
    });
    const mfaRequired = row.user.mfaSetupRequired || (await isTwoFactorRequired());
    const stillHasSecondFactor = row.user.mfaEnabled && !replacingPasskeys;
    // An account with no second factor yet goes straight on to adding one, with no extra sign-in: the link
    // proved the inbox and the page then makes the person enrol an authenticator app (the passkey route is
    // /password-setup/passkey), and finishing that signs them in. An account that already has two-factor,
    // and a public demo, get no session from a link alone: they sign in the normal way and meet their
    // second factor there.
    if (!stillHasSecondFactor && !isDemoDeployment()) {
      return res.json({ ok: true, mfaRequired, setupToken: signMfaSetupToken(row.user) });
    }
    res.json({ ok: true, mfaRequired });
  } catch (err) {
    next(err);
  }
});

// The other way to finish a setup link: no password at all, a passkey on this device. Spends the link and
// hands back a short-lived enrolment token (the same one a forced enrolment uses), which the page uses to
// register the passkey; registering signs the person in. The link is burned here, so an abandoned attempt
// needs a new one.
//
// A link alone never replaces a second factor someone already has: an account with a password and two-factor
// is refused. An account with only passkeys (no password, so the passkey was its whole sign-in) is the lost-
// device case: the link clears its old passkeys first, as an administrator's Reset MFA does.
router.post("/password-setup/passkey", noPasswordChangeOnDemo, async (req, res, next) => {
  try {
    if (!(await isPasskeySignInOn())) {
      return res.status(400).json({ error: "Passkeys aren't available on this site." });
    }
    const row = await findValidSetupToken(String(req.body?.token || ""));
    if (!row) return res.status(400).json({ error: SETUP_LINK_INVALID });
    const user = row.user;
    if (user.mfaEnabled && user.passwordHash) {
      return res.status(400).json({
        error:
          "This account already has two-factor sign-in, which a link can't replace. Sign in, or ask an administrator to reset it.",
      });
    }
    const replacing = user.mfaEnabled && !user.passwordHash;
    await prisma.$transaction([
      ...(replacing
        ? [
            prisma.userPasskey.deleteMany({ where: { userId: user.id } }),
            prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } }),
            prisma.user.update({
              where: { id: user.id },
              data: { mfaEnabled: false, mfaSecret: null, ...endOtherSessions() },
            }),
          ]
        : []),
      prisma.passwordSetupToken.deleteMany({ where: { userId: user.id } }),
    ]);
    await recordAuditSafe(null, {
      action: replacing ? "auth.passkeys_replaced_by_link" : "auth.passkey_setup_started",
      actor: user,
      req,
    });
    res.json({ ok: true, setupToken: signMfaSetupToken(user) });
  } catch (err) {
    next(err);
  }
});

// "Send me a link": first-time setup (no password yet) or "I forgot my
// password". The same reply for every address, and the email goes out after
// responding, so neither the message nor the response time reveals whether an
// account exists.
router.post("/password-setup/request", async (req, res) => {
  // Whether email works is church-wide, so saying so reveals nothing about any
  // account; with it off the page says to ask an administrator. A failed lookup
  // falls back to the generic reply.
  let emailOn = true;
  try {
    const settings = await prisma.churchSettings.findUnique({
      where: { id: "singleton" },
      select: READY_SELECT,
    });
    emailOn = isOutboundEmailReady(settings);
  } catch {
    // keep the generic reply
  }
  res.json(
    emailOn
      ? {
          ok: true,
          message: "If that email has an account, a new link to set up your sign-in is on its way.",
        }
      : {
          ok: true,
          emailOff: true,
          message:
            "This site can't send email, so we can't send a link. Please ask your church administrator for a new setup link.",
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
    // No send when email is off (an admin hands over a link instead) or on a
    // public demo (fake addresses, shared logins). sendWelcomeEmail throws when
    // outboundEmail is off, so skipping here is deliberate.
    if (!emailOn || isDemoDeployment()) return;
    if (!user || !user.active || user.authProvider !== "local") return;
    if (!user.passwordHash) {
      // At most one a minute, as for a reset: otherwise anyone could mail-bomb a person with setup links.
      const recentSetup = await prisma.passwordSetupToken.findFirst({
        where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
        select: { id: true },
      });
      if (recentSetup) return;
      await sendWelcomeEmail(user, { requireMfa: user.mfaSetupRequired });
      return;
    }
    // Has a password: send a reset link, but not while passwordless is on (no
    // password to reset) and at most one a minute per account.
    if (await isPasswordlessOn()) return;
    const recent = await prisma.passwordSetupToken.findFirst({
      where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) return;
    await sendPasswordResetEmail(user);
  } catch {
    // Deliberately swallowed: this endpoint must never signal a difference.
  }
});

// Generates a new secret and QR code; mfaEnabled stays false until confirmed
// via /mfa/verify-setup, so an abandoned attempt leaves nothing half-configured.
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

    // The QR code / manual-entry value must be the raw secret; encryption is only for storage.
    const otpauth = generateURI({ issuer: MFA_ISSUER, label: user.email, secret });
    const qrCode = await QRCode.toDataURL(otpauth);

    res.json({ secret, qrCode });
  } catch (err) {
    next(err);
  }
});

// Confirms setup with a real code, proving the QR code was scanned before MFA
// becomes mandatory. Always returns a fresh session: a forced-setup caller has
// none yet, and a voluntary one can ignore it.
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

    // completeLogin re-issues the cookie from this updated row, so only sessions
    // opened before enrolment are invalidated.
    const { updated, recoveryCodes } = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          mfaSetupRequired: false,
          mfaLastTimeStep: timeStep,
          ...endOtherSessions(),
        },
      });
      return { updated: row, recoveryCodes: await issueRecoveryCodes(user.id, tx) };
    });
    await recordAuditSafe(null, { action: "auth.mfa_enabled", actor: updated, req });
    // The codes come back once, here; the screen makes the person confirm they've saved them.
    res.json({ ...(await completeLogin(res, updated, req)), recoveryCodes });
  } catch (err) {
    next(err);
  }
});

// Requires the current password (not just a session) so a hijacked browser tab
// can't silently strip MFA. While the church requires two-factor nobody can
// switch it off here; a lost authenticator is cleared by the admin-side reset
// (POST /api/users/:id/mfa/reset).
router.post("/mfa/disable", requireAuth, async (req, res, next) => {
  try {
    if (await isTwoFactorRequired()) {
      return res.status(403).json({ error: "Your church requires two-factor authentication" });
    }
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Current password is required" });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.passwordHash) return res.status(400).json({ error: "Invalid account" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    // Re-issue this tab's cookie (see change-password) so only other sessions stop working.
    // Passkeys are a second factor too: mfaEnabled only goes off when none are left.
    const hasPasskeys = (await prisma.userPasskey.count({ where: { userId: user.id } })) > 0;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaSecret: null,
        mfaEnabled: hasPasskeys,
        ...endOtherSessions(),
      },
    });
    await prisma.userRecoveryCode.deleteMany({ where: { userId: user.id } });
    setSessionCookie(res, updated);
    await recordAuditSafe(null, { action: "auth.mfa_disabled", actor: updated, req });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// A fresh set of recovery codes, retiring every older one. Needs the current password for the same reason
// disabling does, and only an account that has an authenticator app has any use for them.
router.post("/mfa/recovery-codes", requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Current password is required" });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.passwordHash) return res.status(400).json({ error: "Invalid account" });
    if (!user.mfaEnabled || !user.mfaSecret) {
      return res
        .status(400)
        .json({ error: "Recovery codes go with an authenticator app. Set one up first." });
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const recoveryCodes = await issueRecoveryCodes(user.id);
    await recordAuditSafe(null, { action: "auth.recovery_codes_regenerated", actor: user, req });
    res.json({ recoveryCodes });
  } catch (err) {
    next(err);
  }
});

// Self-service digest cadence + scope: a plain preference, so no password
// confirmation. A scope other than "followed" (or cadence: null) always clears any
// UserFollowedPartner rows rather than leaving them unread, so stale scope
// data can't resurface when the scope is switched back to "followed".
const digestSubscriptionSchema = z.object({
  cadence: z.enum(["biweekly", "monthly", "quarterly"]).nullable(),
  // "owned" = the partners you look after; "all"; "followed" = the partnerIds you pick. A guest is always "owned".
  digestScope: z.enum(["owned", "all", "followed"]).optional().default("owned"),
  partnerIds: z.array(z.string()).optional().default([]),
});
router.put("/dispatch-by-email", requireAuth, async (req, res, next) => {
  try {
    // The church-wide digest carries every partner's prayer requests, needs and amounts, which a guest must never
    // receive. A care team guest may subscribe only to the partners they hold a seat on (scope forced to "owned"
    // below and again at send time); a guest with no seat has nothing to subscribe to.
    if (req.user.role === "guest" && !(await isCareTeamEnabled())) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (req.user.role === "guest") {
      const seats = await prisma.careTeamMember.count({ where: { userId: req.user.id } });
      if (seats === 0) return res.status(403).json({ error: "Insufficient permissions" });
    }
    const parsed = digestSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    }
    const { cadence, partnerIds } = parsed.data;
    const digestScope = req.user.role === "guest" ? "owned" : parsed.data.digestScope;

    // Unlike the public subscribe route (which silently drops invalid ids so an
    // anonymous caller learns nothing), this is authenticated, so a bad id is a
    // real 400. Only archived partners are excluded, not non-public ones.
    let validPartnerIds = [];
    if (!cadence || digestScope !== "followed") {
      // Unsubscribing, or a scope that isn't a hand-picked list: any partnerIds sent are ignored.
    } else if (partnerIds.length === 0) {
      return res.status(400).json({ error: "Pick at least one partner, or choose another scope" });
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
        data: { cadence, digestScope },
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

// The daily key-date email for care team members. Anyone signed in (a care
// team guest included) may turn their own off; the bell alert is unaffected.
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

// Self-service: your own phone and profile (a line about how you help or when you are easiest to
// reach). Open to every role, a guest included; name and email stay admin-managed.
router.put("/profile", requireAuth, async (req, res, next) => {
  try {
    const data = z
      .object({
        phone: phoneSchema(z),
        profile: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(req.body);
    const updateData = {};
    if (data.phone !== undefined) updateData.phone = data.phone || null;
    if (data.profile !== undefined) updateData.profile = data.profile || null;
    const user = await prisma.user.update({ where: { id: req.user.id }, data: updateData });
    res.json({ user: await sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

// Plain HTML page (not JSON) for the unsubscribe link in digest emails (see
// utils/emailDispatchShell.js's buildUnsubscribeUrl). Branded like the email's
// header band (same colors, font and fallbacks). `message` is a string, or a
// (highlightColor) => string for the confirm button's brand color.
async function renderUnsubscribePage(message) {
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
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email notifications</title></head>
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

// Public (reached from an email link), authenticated by a signed
// { id, unsubscribe: true } token verified here, not by requireAuth. GET must
// not unsubscribe: mail security scanners pre-fetch links. It only renders a
// confirm form (plain POST, works without JavaScript); POST does the work.
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

// Token in req.body (the confirm form) or req.query (RFC 8058 one-click: a mail
// client's native button POSTs to the List-Unsubscribe URL, token in the URL).
router.post("/unsubscribe", express.urlencoded({ extended: false }), async (req, res) => {
  const decoded = verifyUnsubscribeToken(req.body?.token || req.query?.token);
  if (!decoded)
    return res.status(400).send(await renderUnsubscribePage("This unsubscribe link isn't valid."));

  // Clear followed partners too (see PUT /dispatch-by-email).
  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: decoded.id }, data: { cadence: null } }),
    prisma.userFollowedPartner.deleteMany({ where: { userId: decoded.id } }),
  ]);
  res.send(await renderUnsubscribePage("You've been unsubscribed from email notifications."));
});

router.post("/logout", (req, res) => {
  // The session is an httpOnly cookie, so only the server can clear it.
  clearSessionCookie(res);
  res.json({ ok: true });
});

// "Sign out of all devices": ends every open session of this account, this browser included. A session is a signed
// cookie that carries the account's session number (sessionVersion); raising the number makes every cookie issued
// before it stop working (middleware/requireAuth.js), the same thing a password change does. Useful after signing in
// on a shared computer or losing a phone. No password is asked for: it can only sign people out, never in.
// Not on a demo, whose logins are shared: it would sign every visitor out.
router.post("/logout-all", requireAuth, async (req, res, next) => {
  try {
    if (isDemoDeployment()) {
      return res.status(403).json({ error: "Signing out of all devices isn't available on the public demo" });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { sessionVersion: { increment: 1 } } });
    clearSessionCookie(res);
    await recordAuditSafe(null, { action: "auth.logout_all", actor: req.user, req });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Followed-partner ids come from a separate query, run only when
// the scope is hand-picked partners with a real subscription.
async function sanitizeUser(user) {
  let partnerIds = [];
  if (user.cadence && user.digestScope === "followed") {
    const rows = await prisma.userFollowedPartner.findMany({
      where: { userId: user.id },
      select: { partnerId: true },
    });
    partnerIds = rows.map((r) => r.partnerId);
  }
  // Guest tier only: the trips their active grants reach, as short labels for
  // the sidebar (a guest has no other route that hands them this).
  // partnerId/partnerLabel link to the trip's partner, if it has one;
  // partnerLabel prefers displayName so the link matches the partner page.
  let guestTrips = [];
  // [{ id, label, isLead }] for the partners this login is on the care team of,
  // for every role. Empty while the careTeam feature is off (seats are ignored).
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
  // Every trip a guest may open: those they hold a grant for (read/write) plus,
  // via a care team seat, every trip of that partner (read only). The route
  // guard uses this so a guest is only sent to pages the server will show.
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
    phone: user.phone,
    profile: user.profile,
    onMissionsTeam: user.onMissionsTeam === true,
    role: user.role,
    authProvider: user.authProvider,
    mfaEnabled: user.mfaEnabled,
    authenticatorApp: Boolean(user.mfaEnabled && user.mfaSecret),
    passkeyCount: await prisma.userPasskey.count({ where: { userId: user.id } }),
    recoveryCodesRemaining:
      user.mfaEnabled && user.mfaSecret ? await countUnusedRecoveryCodes(user.id) : null,
    cadence: user.cadence,
    digestScope: user.role === "guest" ? "owned" : user.digestScope,
    followedPartnerIds: partnerIds,
    keyDateEmailOptOut: user.keyDateEmailOptOut === true,
    guestTrips,
    guestReadTripIds,
    careTeamSeats,
  };
}

// Mounted here so passkeys can finish a sign-in the same way a code does.
router.use("/passkeys", require("./passkeys")({ completeLogin }));

module.exports = router;
