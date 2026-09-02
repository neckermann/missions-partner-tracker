const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const prisma = require("../prismaClient");
const { requireAuth, requireAuthOrMfaSetup } = require("../middleware/requireAuth");
const { setSessionCookie, clearSessionCookie } = require("../utils/jwt");
const { encryptField, decryptField } = require("../utils/crypto");

const router = express.Router();
const MFA_PENDING_TTL = "5m";
const MFA_SETUP_TTL = "20m";
// Shown in the user's authenticator app (Google Authenticator, Authy, etc.)
// next to their account when they scan the MFA setup QR code.
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
  return { user: sanitizeUser(user) };
}

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

    if (!user || !user.active || user.authProvider !== "local" || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

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

    const valid = authenticator.check(String(token), decryptField(user.mfaSecret));
    if (!valid) return res.status(401).json({ error: "Invalid code" });

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
    if (!user) return res.status(401).json({ error: "Invalid or expired session" });
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

// Self-service password change — requires knowing the current password,
// unlike the admin-only reset in routes/users.js.
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || user.authProvider !== "local" || !user.passwordHash) {
      return res.status(400).json({ error: "Password changes aren't available for SSO accounts" });
    }

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
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

    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encryptField(secret) } });

    // The QR code / manual-entry value must be the raw secret — encryption
    // is only for what's persisted to the database.
    const otpauth = authenticator.keyuri(user.email, MFA_ISSUER, secret);
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

    const valid = authenticator.check(String(token), decryptField(user.mfaSecret));
    if (!valid) return res.status(401).json({ error: "Invalid code" });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSetupRequired: false },
    });
    res.json(await completeLogin(res, updated));
  } catch (err) {
    next(err);
  }
});

// Requires the current password (not just an active session) so a hijacked
// browser tab can't silently strip MFA off the account.
router.post("/mfa/disable", requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Current password is required" });

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !user.passwordHash) return res.status(400).json({ error: "Invalid account" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res) => {
  // The session lives in an httpOnly cookie, so client-side JS can't clear
  // it itself — this is the only way to actually log out.
  clearSessionCookie(res);
  res.json({ ok: true });
});

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider: user.authProvider,
    mfaEnabled: user.mfaEnabled,
  };
}

module.exports = router;
