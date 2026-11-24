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
async function completeLogin(res, user) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setSessionCookie(res, user);
  return { user: await sanitizeUser(user) };
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
    res.json({ needed: count === 0 });
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
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
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
    await prisma.churchSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton", tripRequirementTemplate: DEFAULT_TRIP_REQUIREMENT_TEMPLATE },
    });

    res.status(201).json(await completeLogin(res, user));
  } catch (err) {
    next(err);
  }
});

// --- Local (username/password) ---
router.post("/login", async (req, res, next) => {
  try {
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
    if (!usable || !match) return res.status(401).json({ error: "Invalid credentials" });

    if (user.mfaEnabled) {
      return res.json({ mfaRequired: true, pendingToken: signMfaPendingToken(user) });
    }
    if (user.mfaSetupRequired) {
      return res.json({ mfaSetupRequired: true, setupToken: signMfaSetupToken(user) });
    }

    res.json(await completeLogin(res, user));
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
    if (!valid) return res.status(401).json({ error: "Invalid code" });

    await prisma.user.update({ where: { id: user.id }, data: { mfaLastTimeStep: timeStep } });

    res.json(await completeLogin(res, user));
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
    res.json({ user: await sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

// Self-service password change — requires knowing the current password,
// unlike the admin-only reset in routes/users.js.
//
// #329 Finding 2: a Trip Leader scoped guest (role: "tripLeader") is
// fully admin-managed, not self-service -- AdminSidebar.jsx's
// TripLeaderSidebar deliberately renders no "My Account" link, and
// AdminLayout.jsx's own route guard already redirects a tripLeader away
// from /admin/account entirely (both predate this fix and already
// documented the intended policy; the backend just hadn't caught up).
// This was the one surface where that policy actually disagreed: a
// tripLeader who hit this endpoint directly (no UI route needed one) got
// a real password change. Blocked here instead of requiring a
// password-setup-link resend from an admin, the same way their account
// got set up in the first place.
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === "tripLeader") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
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

router.get("/password-setup/validate", async (req, res, next) => {
  try {
    const row = await findValidSetupToken(String(req.query.token || ""));
    if (!row) return res.status(400).json({ error: SETUP_LINK_INVALID });
    res.json({
      email: row.user.email,
      firstName: row.user.firstName || null,
      mfaRequired: row.user.mfaSetupRequired,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/password-setup/complete", async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 8 and 128 characters" });
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
    // Not signed in here on purpose: they sign in normally next, which also
    // runs the forced two-factor enrollment when it's required.
    res.json({ ok: true, mfaRequired: row.user.mfaSetupRequired });
  } catch (err) {
    next(err);
  }
});

// "Send me a new link." Always the same generic reply, and the email goes
// out after responding, so neither the message nor the response time
// reveals whether an account exists.
router.post("/password-setup/request", async (req, res) => {
  res.json({
    ok: true,
    message: "If that email has an account waiting to be set up, a new link is on its way.",
  });
  try {
    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    if (!email) return;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.active && user.authProvider === "local" && !user.passwordHash) {
      // Explicit check, same as users.js's own sendWelcomeEmail call sites --
      // without it, this would still "work" by accident: sendWelcomeEmail
      // throws when outboundEmail is off, and the catch below swallows it.
      // That's incidental, not intentional, and fragile the next time this
      // route changes. No manual-link fallback to offer here (unlike
      // users.js, this is self-service with no admin present to hand a
      // link to), so skip the send outright rather than invent one.
      const settings = await prisma.churchSettings.findUnique({
        where: { id: "singleton" },
        select: { enabledFeatures: true },
      });
      if (isFeatureEnabled(settings?.enabledFeatures, "outboundEmail")) {
        await sendWelcomeEmail(user, { requireMfa: user.mfaSetupRequired });
      }
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
    // #329 Finding 2: voluntary self-service enrollment (a real session,
    // req.user.role === "tripLeader") is the one disallowed path here --
    // same "fully admin-managed, not self-service" policy as
    // change-password above. A forced-setup token (req.user = { id,
    // mfaSetup: true }, no role claim at all -- see signMfaSetupToken)
    // must still work regardless of role: an admin can require MFA on a
    // tripLeader account (AdminUserForm.jsx's "Require two-factor
    // authentication at first sign-in" checkbox is unconditional), and
    // that first-sign-in enrollment is mandatory, not voluntary, so it's
    // never blocked here.
    if (req.user.role === "tripLeader") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
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
    // #329 Finding 2: same voluntary-vs-forced distinction as /mfa/setup
    // above -- only blocks a real session whose role is tripLeader, not a
    // forced-setup token (no role claim) completing mandatory enrollment.
    if (req.user.role === "tripLeader") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
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
    res.json(await completeLogin(res, updated));
  } catch (err) {
    next(err);
  }
});

// Requires the current password (not just an active session) so a hijacked
// browser tab can't silently strip MFA off the account.
//
// #329 Finding 2: same "fully admin-managed, not self-service" policy as
// change-password/mfa-setup above -- an admin who needs to turn MFA off
// a tripLeader account uses routes/users.js's own admin-side MFA reset
// (POST /api/users/:id/mfa/reset) instead of this self-service endpoint.
router.post("/mfa/disable", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === "tripLeader") {
      return res.status(403).json({ error: "Insufficient permissions" });
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
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null, sessionVersion: { increment: 1 } },
    });
    setSessionCookie(res, updated);
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
router.get("/unsubscribe", async (req, res) => {
  // Branded to match the digest email's own header-band treatment (see
  // utils/emailDispatchShell.js) -- same three colors/font, same fallbacks, so
  // this doesn't look like a different, unbranded app once clicked into
  // from the email.
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { churchName: true, headerColor: true, logoContentType: true, brandFont: true },
  });
  const churchName = settings?.churchName || "Missions Partner Tracker";
  const headerColor = settings?.headerColor || "#2c2a28";
  const fontFamily =
    settings?.brandFont || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const base = appBaseUrl();
  const logoHtml =
    settings?.logoContentType && base
      ? `<img src="${base}/api/public/settings/logo/raw" alt="${escapeHtml(churchName)}" style="max-height:40px;width:auto;max-width:240px;margin-bottom:10px;">`
      : "";

  const page = (message) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Email notifications</title></head>
<body style="font-family:${fontFamily};background:#f7f5f0;margin:0;padding:40px 16px;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
  <div style="background-color:${headerColor};padding:28px 24px;text-align:center;">
    ${logoHtml}
    <h2 style="margin:0;color:#ffffff;font-size:18px;">${escapeHtml(churchName)}</h2>
  </div>
  <div style="padding:32px 24px;text-align:center;color:#222;">
    <p style="margin:0;font-size:16px;line-height:1.5;">${message}</p>
  </div>
</div>
</body></html>`;

  let decoded;
  try {
    decoded = jwt.verify(String(req.query.token || ""), process.env.SESSION_SECRET);
  } catch {
    return res.status(400).send(page("This unsubscribe link isn't valid."));
  }
  if (!decoded?.unsubscribe || !decoded.id) {
    return res.status(400).send(page("This unsubscribe link isn't valid."));
  }

  // Same "don't leave stale scope data around" reasoning as PUT
  // /dispatch-by-email's own cadence: null handling above.
  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: decoded.id }, data: { cadence: null } }),
    prisma.userFollowedPartner.deleteMany({ where: { userId: decoded.id } }),
  ]);
  res.send(page("You've been unsubscribed from email notifications."));
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
  // Trip Leader guest tier only -- a short label for the sidebar's own
  // minimal nav (AdminSidebar.jsx), not the full Trip record. Looked up
  // here rather than left for the frontend to fetch separately, since a
  // tripLeader has no route that would otherwise ever hand them this.
  // partnerId/partnerLabel let that same sidebar link to the one Partner
  // a tripLeader may read (Trip.partnerId is optional -- a trip with no
  // linked partner yet means no such link to show).
  let scopedTrip = null;
  if (user.scopedTripId) {
    const trip = await prisma.trip.findUnique({
      where: { id: user.scopedTripId },
      select: {
        id: true,
        name: true,
        type: true,
        partnerId: true,
        partner: { select: { displayName: true, fieldDisplayName: true } },
      },
    });
    if (trip) {
      scopedTrip = {
        id: trip.id,
        label:
          trip.name ||
          trip.type ||
          trip.partner?.fieldDisplayName ||
          trip.partner?.displayName ||
          "Your trip",
        partnerId: trip.partnerId,
        partnerLabel: trip.partner?.fieldDisplayName || trip.partner?.displayName || null,
      };
    }
  }
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    authProvider: user.authProvider,
    mfaEnabled: user.mfaEnabled,
    cadence: user.cadence,
    allPartners: user.allPartners,
    followedPartnerIds: partnerIds,
    scopedTripId: user.scopedTripId,
    scopedTrip,
  };
}

module.exports = router;
