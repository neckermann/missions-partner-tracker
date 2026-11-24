const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const prisma = require("../prismaClient");
const { requireAuth, requireAuthOrMfaSetup } = require("../middleware/requireAuth");
const { setSessionCookie } = require("../utils/jwt");
const { recordAuditSafe } = require("../utils/auditLog");
const { isTwoFactorRequired } = require("../utils/twoFactor");
const {
  MAX_PASSKEYS,
  relyingParty,
  signChallenge,
  consumeChallenge,
  toB64u,
  fromB64u,
} = require("../utils/passkeys");

// #386: passkeys as a second sign-in factor. Mounted at /api/auth/passkeys by routes/auth.js,
// which hands over its `completeLogin` so a passkey sign-in ends exactly as a code sign-in does.
module.exports = function passkeyRoutes({ completeLogin }) {
  const router = express.Router();

  const publicPasskey = (p) => ({
    id: p.id,
    label: p.label,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  });

  // GET /api/auth/passkeys -- the signed-in person's own passkeys.
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const rows = await prisma.userPasskey.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: "asc" },
      });
      res.json({ passkeys: rows.map(publicPasskey), max: MAX_PASSKEYS });
    } catch (err) {
      next(err);
    }
  });

  // ---- Adding one ----------------------------------------------------------------------
  // A session, or the forced-enrolment setup token (a person the church requires two-factor of
  // who has none yet): in that case finishing also signs them in, like a verified code does.

  router.post("/register/options", requireAuthOrMfaSetup, async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { passkeys: { select: { credentialId: true, transports: true } } },
      });
      if (!user) return res.status(401).json({ error: "Invalid or expired session" });
      if (user.passkeys.length >= MAX_PASSKEYS) {
        return res.status(409).json({ error: `You can have up to ${MAX_PASSKEYS} passkeys` });
      }
      const rp = relyingParty(req);
      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userName: user.email,
        userID: new TextEncoder().encode(user.id),
        userDisplayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
        attestationType: "none",
        excludeCredentials: user.passkeys.map((p) => ({
          id: p.credentialId,
          transports: p.transports,
        })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      });
      res.json({
        options,
        challengeToken: signChallenge({
          challenge: options.challenge,
          purpose: "register",
          userId: user.id,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  const registerSchema = z.object({
    challengeToken: z.string().min(1),
    response: z.object({ id: z.string().min(1) }).passthrough(),
    label: z.string().trim().max(60).optional(),
  });

  router.post("/register/verify", requireAuthOrMfaSetup, async (req, res, next) => {
    try {
      const body = registerSchema.parse(req.body);
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { _count: { select: { passkeys: true } } },
      });
      if (!user) return res.status(401).json({ error: "Invalid or expired session" });
      if (user._count.passkeys >= MAX_PASSKEYS) {
        return res.status(409).json({ error: `You can have up to ${MAX_PASSKEYS} passkeys` });
      }
      const challenge = consumeChallenge(body.challengeToken, { purpose: "register", userId: user.id });
      if (!challenge) return res.status(400).json({ error: "That took too long. Please try again." });

      const rp = relyingParty(req);
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: rp.origins,
          expectedRPID: rp.rpID,
        });
      } catch {
        return res.status(400).json({ error: "That passkey couldn't be verified" });
      }
      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: "That passkey couldn't be verified" });
      }
      const { credential } = verification.registrationInfo;
      const label = body.label || `Passkey ${user._count.passkeys + 1}`;
      try {
        await prisma.userPasskey.create({
          data: {
            userId: user.id,
            credentialId: credential.id,
            publicKey: toB64u(credential.publicKey),
            counter: credential.counter,
            transports: credential.transports || [],
            label,
          },
        });
      } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ error: "That passkey is already registered" });
        throw err;
      }
      // An abandoned authenticator-app enrolment (secret saved, never confirmed) is cleared so a
      // person is never half in each.
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: user.mfaEnabled
          ? {}
          : { mfaEnabled: true, mfaSecret: null, mfaSetupRequired: false, mfaLastTimeStep: null },
      });
      await recordAuditSafe(null, {
        action: "auth.passkey_added",
        actor: updated,
        req,
        details: { label },
      });
      if (req.user.mfaSetup) {
        return res.json(await completeLogin(res, updated, req));
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Removing one --------------------------------------------------------------------

  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: "Current password is required" });
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user || !user.passwordHash) return res.status(400).json({ error: "Invalid account" });
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      const passkey = await prisma.userPasskey.findFirst({
        where: { id: req.params.id, userId: user.id },
      });
      if (!passkey) return res.status(404).json({ error: "Not found" });

      const remaining = await prisma.userPasskey.count({ where: { userId: user.id, id: { not: passkey.id } } });
      const hasApp = Boolean(user.mfaSecret);
      const lastFactor = remaining === 0 && !hasApp;
      if (lastFactor && (await isTwoFactorRequired())) {
        return res.status(403).json({
          error: "Your church requires two-factor authentication. Add another passkey or an authenticator app first.",
        });
      }
      await prisma.userPasskey.delete({ where: { id: passkey.id } });
      let updated = user;
      if (lastFactor) {
        // Nothing left to ask for, and sessions opened with it end, as when two-factor is switched off.
        updated = await prisma.user.update({
          where: { id: user.id },
          data: { mfaEnabled: false, sessionVersion: { increment: 1 } },
        });
        setSessionCookie(res, updated);
      }
      await recordAuditSafe(null, {
        action: "auth.passkey_removed",
        actor: updated,
        req,
        details: { label: passkey.label },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Signing in ----------------------------------------------------------------------
  // Second step after a correct password, exactly where the authenticator-app code goes.

  function pendingUser(pendingToken) {
    let decoded;
    try {
      decoded = jwt.verify(String(pendingToken || ""), process.env.SESSION_SECRET);
    } catch {
      return null;
    }
    return decoded.mfaPending ? decoded.id : null;
  }

  router.post("/login/options", async (req, res, next) => {
    try {
      const userId = pendingUser(req.body?.pendingToken);
      const user = userId
        ? await prisma.user.findUnique({ where: { id: userId }, include: { passkeys: true } })
        : null;
      if (!user || !user.active || !user.mfaEnabled || user.passkeys.length === 0) {
        return res.status(401).json({ error: "MFA session expired, please log in again" });
      }
      const rp = relyingParty(req);
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: "preferred",
        allowCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports })),
      });
      res.json({
        options,
        challengeToken: signChallenge({ challenge: options.challenge, purpose: "login", userId: user.id }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login/verify", async (req, res, next) => {
    try {
      const { pendingToken, challengeToken, response } = req.body || {};
      const userId = pendingUser(pendingToken);
      if (!userId || !response || typeof response.id !== "string") {
        return res.status(401).json({ error: "MFA session expired, please log in again" });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const passkey = await prisma.userPasskey.findFirst({
        where: { userId, credentialId: response.id },
      });
      const fail = async (reason) => {
        if (user) {
          await recordAuditSafe(null, {
            action: "auth.login_failed",
            target: user,
            req,
            details: { reason },
          });
        }
        return res.status(401).json({ error: "That passkey didn't work" });
      };
      if (!user || !user.active || !user.mfaEnabled || !passkey) return fail("passkey_unknown");
      const challenge = consumeChallenge(challengeToken, { purpose: "login", userId });
      if (!challenge) return fail("passkey_challenge");

      const rp = relyingParty(req);
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rp.origins,
          expectedRPID: rp.rpID,
          credential: {
            id: passkey.credentialId,
            publicKey: fromB64u(passkey.publicKey),
            counter: passkey.counter,
            transports: passkey.transports,
          },
        });
      } catch {
        return fail("passkey_invalid");
      }
      if (!verification.verified) return fail("passkey_invalid");
      await prisma.userPasskey.update({
        where: { id: passkey.id },
        data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
      });
      res.json(await completeLogin(res, user, req));
    } catch (err) {
      next(err);
    }
  });

  return router;
};
